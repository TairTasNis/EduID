import type { SchoolSource } from './contracts';

type NormalizedSubject = {
  name: string;
  formativeMarks: string[];
  sorMarks: string[];
  sochMarks: string[];
  formativePercent: number | null;
  sorPercent: number | null;
  sochPercent: number | null;
  sorColorPercent: number | null;
  sochColorPercent: number | null;
  finalPercent: number | null;
  quarterGrade?: string | number | null;
};

function parseRatioOrPercent(val: unknown): number | null {
  if (typeof val === 'number') return val >= 0 ? val : null;
  if (!val || typeof val !== 'string') return null;
  const str = val.trim();
  if (str === '-' || str === '✖' || str.startsWith('-')) return null;
  const ratioMatch = str.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (ratioMatch) {
    const s = parseFloat(ratioMatch[1].replace(',', '.'));
    const m = parseFloat(ratioMatch[2].replace(',', '.'));
    return m > 0 && s >= 0 ? (s / m) * 100 : null;
  }
  const pctMatch = str.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (pctMatch) {
    const p = parseFloat(pctMatch[1].replace(',', '.'));
    return p >= 0 ? p : null;
  }
  const num = parseFloat(str.replace(',', '.'));
  return !isNaN(num) && num >= 0 ? num : null;
}

function normalizeSubject(sub: any, source: SchoolSource): NormalizedSubject {
  const name = sub?.subject || sub?.name || 'Предмет';

  const formativeMarks: string[] = [];
  const assessments = { sor: [] as string[], soch: [] as string[] };
  for (const mark of Array.isArray(sub?.marks) ? sub.marks : []) {
    if (mark == null) continue;
    const value = typeof mark === 'object' ? mark.value ?? mark.score ?? mark.mark : mark;
    if (value == null || String(value).trim() === '' || value === '-') continue;
    const kind = mark.kind === 'sor' || /^(СОР|БЖБ)(?:\s|$)/iu.test(mark.type ?? '') ? 'sor'
      : mark.kind === 'soch' || /^(СОЧ|ТЖБ)(?:\s|$)/iu.test(mark.type ?? '') ? 'soch' : null;
    const max = Number(mark.max ?? mark.maxScore);
    if (source === 'bilimclass' && kind) {
      assessments[kind].push(max > 0 && !String(value).includes('/') ? `${value}/${max}` : String(value));
    } else {
      formativeMarks.push(String(value));
    }
  }
  const formativePercent = typeof sub?.formativePercent === 'number' ? sub.formativePercent : null;

  // СОР
  let sorPercent: number | null = null;
  if (typeof sub?.sorPercent === 'number' && sub.sorPercent >= 0) {
    sorPercent = sub.sorPercent;
  } else if (Array.isArray(sub?.evaluations)) {
    const sorEval = sub.evaluations.find((e: any) => e.shortName === 'СОР' || (typeof e.name === 'string' && e.name.includes('раздел')));
    if (sorEval) {
      const score = parseFloat(String(sorEval.score || '').replace(',', '.'));
      const maxScore = parseFloat(String(sorEval.maxScore || '').replace(',', '.'));
      if (maxScore > 0 && !isNaN(score) && score >= 0) {
        sorPercent = Math.round((score / maxScore) * 100);
      } else if (sorEval.percent) {
        sorPercent = parseRatioOrPercent(sorEval.percent);
      }
    }
  } else if (Array.isArray(sub?.sors)) {
    const valid = sub.sors.filter((s: any) => s !== '-' && s !== '✖' && s != null && !String(s).startsWith('-'));
    if (valid.length) {
      let totalSc = 0, totalMax = 0;
      for (const s of valid) {
        const parts = String(s).split('/');
        if (parts.length === 2) {
          const sc = parseFloat(parts[0]);
          const mx = parseFloat(parts[1]);
          if (sc >= 0 && mx > 0) {
            totalSc += sc;
            totalMax += mx;
          }
        }
      }
      if (totalMax > 0) sorPercent = Math.round((totalSc / totalMax) * 100);
    }
  }

  // СОЧ
  let sochPercent: number | null = null;
  if (typeof sub?.sochPercent === 'number' && sub.sochPercent >= 0) {
    sochPercent = sub.sochPercent;
  } else if (Array.isArray(sub?.evaluations)) {
    const sochEval = sub.evaluations.find((e: any) => e.shortName === 'СОЧ' || (typeof e.name === 'string' && e.name.includes('четверть')));
    if (sochEval) {
      const score = parseFloat(String(sochEval.score || '').replace(',', '.'));
      const maxScore = parseFloat(String(sochEval.maxScore || '').replace(',', '.'));
      if (maxScore > 0 && !isNaN(score) && score >= 0) {
        sochPercent = Math.round((score / maxScore) * 100);
      } else if (sochEval.percent) {
        sochPercent = parseRatioOrPercent(sochEval.percent);
      }
    }
  } else if (Array.isArray(sub?.sochs)) {
    const valid = sub.sochs.filter((s: any) => s !== '-' && s !== '✖' && s != null && !String(s).startsWith('-'));
    if (valid.length) {
      let totalSc = 0, totalMax = 0;
      for (const s of valid) {
        const parts = String(s).split('/');
        if (parts.length === 2) {
          const sc = parseFloat(parts[0]);
          const mx = parseFloat(parts[1]);
          if (sc >= 0 && mx > 0) {
            totalSc += sc;
            totalMax += mx;
          }
        }
      }
      if (totalMax > 0) sochPercent = Math.round((totalSc / totalMax) * 100);
    }
  }

  // Расчет итогового процента
  // Формула BilimClass: 25% ФО + 25% СОР + 50% СОЧ = Итоговый процент
  // Формула СУШ: 50% СОР + 50% СОЧ = Итоговый процент
  let finalPercent: number | null = null;

  if (source === 'bilimclass') {
    if (typeof sub?.totalPercent === 'number' && sub.totalPercent > 0) {
      finalPercent = Math.round(sub.totalPercent);
    } else {
      let sum = 0;
      let totalWeight = 0;
      if (formativePercent !== null && formativePercent > 0) {
        sum += formativePercent * 0.25;
        totalWeight += 0.25;
      }
      if (sorPercent !== null && sorPercent > 0) {
        sum += sorPercent * 0.25;
        totalWeight += 0.25;
      }
      if (sochPercent !== null && sochPercent > 0) {
        sum += sochPercent * 0.50;
        totalWeight += 0.50;
      }
      if (totalWeight > 0) {
        finalPercent = Math.round(sum / totalWeight);
      }
    }
  } else {
    // SUSH: 50% СОР + 50% СОЧ
    if (sorPercent !== null && sochPercent !== null) {
      finalPercent = Math.round(sorPercent * 0.50 + sochPercent * 0.50);
    } else if (sorPercent !== null && sochPercent === null) {
      finalPercent = Math.round(sorPercent);
    } else if (typeof sub?.totalPercent === 'number' && sub.totalPercent > 0) {
      finalPercent = Math.round(sub.totalPercent);
    } else if (sub?.score && !isNaN(parseFloat(sub.score)) && parseFloat(sub.score) > 0) {
      finalPercent = Math.round(parseFloat(sub.score));
    }
  }

  const rawGrade = sub?.quarterGrade ?? sub?.finalGrade ?? sub?.mark ?? null;
  const quarterGrade = (rawGrade === '0' || rawGrade === 0 || rawGrade === '-' || rawGrade === 'none') ? null : rawGrade;

  return {
    name,
    formativeMarks,
    sorMarks: assessments.sor,
    sochMarks: assessments.soch,
    formativePercent,
    sorPercent,
    sochPercent,
    // BilimClass exports contributions to the quarter total. СОР weighs 25%
    // when СОЧ is present and 50% otherwise. СОЧ weighs 50%.
    sorColorPercent: source === 'bilimclass' && typeof sub?.sorPercent === 'number' && sorPercent !== null
      ? sorPercent * (sochPercent === null ? 2 : 4) : sorPercent,
    sochColorPercent: source === 'bilimclass' && typeof sub?.sochPercent === 'number' && sochPercent !== null
      ? sochPercent * 2 : sochPercent,
    finalPercent,
    quarterGrade,
  };
}

function readGradeArchive(raw: unknown): any {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

function classNumberFromArchive(entry: any): number | null {
  const label = entry?.class ?? entry?.className ?? entry?.gradeNumber;
  if (typeof label !== 'string' && typeof label !== 'number') return null;
  const match = /^(1[0-2]|[1-9])(?!\d)/.exec(String(label).trim());
  return match ? Number(match[1]) : null;
}

export function classNumberForSchoolYear(raw: unknown, year: string): number | null {
  const archive = readGradeArchive(raw);
  if (!archive) return null;
  if (Array.isArray(archive.history)) {
    const record = archive.history.find((entry: any) =>
      String(entry?.schoolYearName ?? entry?.academicYear ?? '').trim().match(/^20\d{2}(?!\d)/)?.[0] === year);
    return classNumberFromArchive(record);
  }

  const storedYear = String(archive.schoolYearName ?? archive.academicYear ?? '').trim().match(/^20\d{2}(?!\d)/)?.[0];
  if (storedYear && storedYear !== year) return null;
  const direct = classNumberFromArchive(archive);
  if (direct !== null) return direct;
  const periods = Array.isArray(archive.periods) ? archive.periods : Array.isArray(archive) ? archive : [];
  const numbers = new Set(periods.map(classNumberFromArchive).filter((number: number | null) => number !== null));
  return numbers.size === 1 ? Number([...numbers][0]) : null;
}

export function parseGradesForPeriod(gradesMap: Record<string, unknown>, year: string, quarter: number, source: SchoolSource): NormalizedSubject[] {
  const data = readGradeArchive(gradesMap?.[year]);
  if (!data) return [];

  let subjectsRaw: any[] = [];
  const qKey = `quarter${quarter}`;

  // SUSH structure check
  if (data.grades && Array.isArray(data.grades[qKey])) {
    subjectsRaw = data.grades[qKey];
  } else if (Array.isArray(data[qKey])) {
    subjectsRaw = data[qKey];
  } else if (Array.isArray(data.periods)) {
    // BilimClass structure check
    const period = data.periods.find((p: any) =>
      Array.isArray(p?.subjects) && p.subjects.length > 0 && (
        Number(p.quarter) === quarter ||
        (typeof p.quarterLabel === 'string' && p.quarterLabel.includes(String(quarter))) ||
        (typeof p.name === 'string' && p.name.includes(String(quarter)))
      )
    );
    if (period && Array.isArray(period.subjects)) {
      subjectsRaw = period.subjects;
    }
  } else if (Array.isArray(data)) {
    const period = data.find((p: any) =>
      Number(p.quarter) === quarter ||
      (typeof p.Name === 'string' && p.Name.includes(String(quarter))) ||
      (typeof p.name === 'string' && p.name.includes(String(quarter)))
    );
    if (period && Array.isArray(period.subjects)) {
      subjectsRaw = period.subjects;
    } else {
      subjectsRaw = data;
    }
  } else if (data.subjects && Array.isArray(data.subjects)) {
    subjectsRaw = data.subjects;
  }

  const subjects = subjectsRaw.map(s => normalizeSubject(s, source));
  const report = data.grades?.report ?? data.report;
  if (source !== 'sush' || !Array.isArray(report)) return subjects;

  for (const row of report) {
    const mark = String(row?.[`q${quarter}`] ?? '').trim();
    if (!/^[1-5]$/.test(mark) || typeof row?.subject !== 'string' || !row.subject.trim()) continue;
    const subject = subjects.find(item => item.name.trim().toLowerCase() === row.subject.trim().toLowerCase());
    if (subject) subject.quarterGrade ??= mark;
    else subjects.push(normalizeSubject({ subject: row.subject, mark }, source));
  }
  return subjects;
}

export function hasGrades(subjects: NormalizedSubject[]) {
  return subjects.some(subject => subject.quarterGrade != null || subject.finalPercent !== null ||
    subject.formativePercent !== null || subject.sorPercent !== null || subject.sochPercent !== null || subject.formativeMarks.length > 0 ||
    subject.sorMarks.length > 0 || subject.sochMarks.length > 0);
}

export function averageSubjectPercent(years: Iterable<NormalizedSubject[][]>) {
  let count = 0;
  let sum = 0;
  for (const quarters of years) {
    for (const subjects of quarters) {
      for (const { finalPercent } of subjects) {
        if (finalPercent !== null && Number.isFinite(finalPercent) && finalPercent > 0) {
          count++;
          sum += finalPercent;
        }
      }
    }
  }
  return count ? Math.round(sum / count) : null;
}
