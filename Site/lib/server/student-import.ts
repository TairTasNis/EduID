import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database } from 'firebase-admin/database';
import type { ImportStatus } from '../contracts';
import { HttpError } from './http';
import { loadSchoolYear, type SchoolAccount } from './school-api';

type ImportJob = ImportStatus & { id: string; years: string[]; savedYears?: Record<string, true> };
const leaseMs = 6 * 60_000;

export async function startImport(db: Database, uid: string, years: string[]) {
  const status = db.ref(`students/${uid}/import`);
  const id = randomUUID();
  const result = await status.transaction((current: ImportJob | null) => {
    const now = Date.now();
    if (current?.status === 'running' && now - current.updatedAt < leaseMs) return;
    const savedYears = Object.fromEntries(years.filter(year => current?.savedYears?.[year]).map(year => [year, true as const]));
    const completed = Object.keys(savedYears).length;
    if (current?.status === 'complete' && completed === years.length) return;
    return { id, years, savedYears, completed, total: years.length, status: 'running', updatedAt: now } satisfies ImportJob;
  });
  return result.committed ? result.snapshot.val() as ImportJob : null;
}

function hasAnyGrade(yearData: any): boolean {
  if (!yearData) return false;
  const quarters = ['quarter1', 'quarter2', 'quarter3', 'quarter4'];
  for (const q of quarters) {
    const list = yearData.grades?.[q] || yearData[q];
    if (Array.isArray(list) && list.some((s: any) => s && (s.totalPercent !== null || (Array.isArray(s.assessments) && s.assessments.length > 0)))) {
      return true;
    }
  }
  if (Array.isArray(yearData.report) && yearData.report.length > 0) return true;
  if (Array.isArray(yearData.periods) && yearData.periods.some((p: any) => Array.isArray(p.subjects) && p.subjects.length > 0)) return true;
  if (Array.isArray(yearData) && yearData.length > 0) return true;
  return false;
}

export async function runImport(db: Database, uid: string, account: SchoolAccount, job: ImportJob, deadline: number) {
  const student = db.ref(`students/${uid}`);
  const status = student.child('import');
  const savedYears = { ...job.savedYears };
  const pending = job.years.filter(year => !savedYears[year]);
  const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
  let yearFailure: string | null = null;
  try {
    for (const year of pending) {
      signal.throwIfAborted();
      await status.update({ currentYear: year, updatedAt: Date.now() });
      let gradeJson: string;
      let yearData: any;
      try {
        yearData = await loadSchoolYear(account, year, signal);
        gradeJson = JSON.stringify(yearData);
        if (Buffer.byteLength(gradeJson) > 9 * 1024 * 1024) throw new HttpError(502, 'Школьный сервис вернул слишком большой архив за год.');
      } catch (error) {
        if (signal.aborted || (error instanceof HttpError && error.status === 428)) throw error;
        yearFailure ??= error instanceof HttpError ? error.message : 'Не удалось загрузить один из учебных годов.';
        if (Object.keys(savedYears).length > 0) break;
        continue;
      }

      // If an older year has no grades at all, stop probing even older years
      const hasGrades = hasAnyGrade(yearData);
      if (!hasGrades && Object.keys(savedYears).length > 0) {
        break;
      }

      savedYears[year] = true;
      await student.update({
        [`grades/${year}`]: gradeJson,
        [`import/savedYears/${year}`]: true,
        'import/completed': Object.keys(savedYears).length,
        'import/total': Math.max(Object.keys(savedYears).length, job.total),
        'import/updatedAt': Date.now(),
      });
    }
    const finalCount = Object.keys(savedYears).length;
    const isSuccess = !(yearFailure && finalCount === 0);
    await status.update({
      status: isSuccess ? 'complete' : 'failed',
      completed: finalCount,
      total: finalCount,
      message: isSuccess ? null : yearFailure,
      currentYear: null,
      updatedAt: Date.now(),
    });

    try {
      const notifRef = student.child('notifications').push();
      if (isSuccess && finalCount > 0) {
        await notifRef.set({
          id: notifRef.key,
          title: 'Синхронизация оценок завершена',
          message: `Успешно загружены и проверены данные успеваемости за ${finalCount} уч. ${finalCount === 1 ? 'год' : 'года'}.`,
          type: 'success',
          createdAt: Date.now(),
          read: false,
        });
      } else if (!isSuccess) {
        await notifRef.set({
          id: notifRef.key,
          title: 'Ошибка синхронизации оценок',
          message: yearFailure || 'Не удалось загрузить данные из школьной системы.',
          type: 'error',
          createdAt: Date.now(),
          read: false,
        });
      }
    } catch {
      // ignore
    }
  } catch (error) {
    const message = error instanceof HttpError && !signal.aborted ? error.message : 'Импорт прервался. Войдите снова, чтобы продолжить.';
    await status.update({ status: 'failed', message, updatedAt: Date.now() }).catch(() => {});
  }
}
