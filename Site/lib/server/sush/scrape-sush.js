import { SushClient } from "./sush-client.js";
import { encodeSessionToken, decodeSessionToken } from "./session-token.js";
import { summarizeWeightedAssessments } from "./grade-summary.js";
import { applyLanguageLiteratureFinalGrade } from "./report-card-grades.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const QUARTER_KEYS = ["quarter1", "quarter2", "quarter3", "quarter4"];

function roundHalfToEven(value) {
  const floor = Math.floor(value);
  if (value - floor === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

function firstNonEmpty(data, keys) {
  if (!data || typeof data !== "object") return "";
  for (const key of keys) {
    if (data[key] !== null && data[key] !== undefined && String(data[key]).trim()) {
      return String(data[key]).trim();
    }
  }
  return "";
}

export function buildStudentName(student) {
  const fullName = firstNonEmpty(student, [
    "FullName",
    "FIO",
    "Fio",
    "Name",
    "StudentName",
    "DisplayName",
    "PersonName",
  ]);
  if (fullName) return fullName;

  return [
    firstNonEmpty(student, ["LastName", "Lastname", "Surname"]),
    firstNonEmpty(student, ["FirstName", "Firstname", "Name1"]),
    firstNonEmpty(student, ["MiddleName", "Patronymic", "SecondName"]),
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildClassName(klass) {
  const direct = firstNonEmpty(klass, [
    "Name",
    "ClassName",
    "ShortName",
    "KlassName",
    "DisplayName",
    "Title",
  ]);
  if (direct) return direct;

  const grade = firstNonEmpty(klass, ["Grade", "Parallel", "ParallelName", "ParallelNumber"]);
  const letter = firstNonEmpty(klass, ["Letter", "Suffix", "Alpha", "Code"]);
  return grade && letter ? `${grade}${letter}` : grade || letter;
}

export function extractGradeNumber(className) {
  const match = String(className ?? "").match(/\d{1,2}/);
  return match ? Number(match[0]) : null;
}

function inferClassName(currentClassName, gradeNumber) {
  if (!gradeNumber) return String(currentClassName ?? "");
  const current = String(currentClassName ?? "").trim();
  return current.match(/\d{1,2}/) ? current.replace(/\d{1,2}/, String(gradeNumber)) : `${gradeNumber} класс`;
}

function schoolYearStart(year) {
  const match = String(year?.Name ?? "").match(/20\d{2}/);
  return match ? Number(match[0]) : null;
}

function schoolYearKey(year) {
  return `year-${String(year?.Id ?? year?.Name ?? "unknown").replace(/[.#$[\]/]/g, "_")}`;
}

export function selectSchoolYearsForImport(years, currentClassName) {
  if (!Array.isArray(years) || !years.length) return [];
  const actualYear = years.find((year) => year.IsActual) ?? years[0];
  const actualStart = schoolYearStart(actualYear);
  const currentGradeNumber = extractGradeNumber(currentClassName);
  const availableClassCount =
    currentGradeNumber && currentGradeNumber >= 7 ? currentGradeNumber - 6 : 1;
  const olderYears = years
    .filter((year) => String(year.Id) !== String(actualYear.Id))
    .filter((year) => {
      const start = schoolYearStart(year);
      return actualStart === null || start === null || start < actualStart;
    })
    .sort((a, b) => (schoolYearStart(b) ?? -Infinity) - (schoolYearStart(a) ?? -Infinity));
  const dedupedYears = [];
  const seenYearKeys = new Set();
  for (const year of [actualYear, ...olderYears]) {
    const yearId = String(year?.Id ?? "").trim();
    const yearName = String(year?.Name ?? "").trim();
    const start = schoolYearStart(year);
    const dedupKey = yearId ? `id:${yearId}` : `start:${start ?? "unknown"}|name:${yearName}`;
    if (seenYearKeys.has(dedupKey)) continue;
    seenYearKeys.add(dedupKey);
    dedupedYears.push(year);
  }

  return dedupedYears.slice(0, availableClassCount).map((year, index) => {
    const gradeNumber = currentGradeNumber ? currentGradeNumber - index : null;
    return {
      ...year,
      key: schoolYearKey(year),
      gradeNumber,
      inferredClassName: inferClassName(currentClassName, gradeNumber),
      isCurrent: index === 0,
    };
  });
}

export function toIntString(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(",", ".");
  if (!raw || raw.toLowerCase() === "none") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(roundHalfToEven(parsed)) : raw;
}

export function normalizeNumbersInsideText(value) {
  if (value === null || value === undefined) return "-";
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "none") return "-";
  return text.replace(/\d+(?:[.,]\d+)?/g, (match) => toIntString(match) ?? match);
}

function toDecimalString(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(",", ".");
  if (!raw || raw.toLowerCase() === "none") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(roundHalfToEven(parsed * 10) / 10) : raw;
}

function appendEvaluationValue(values, assessments, score, maxScore) {
  const numScore = Number(score);
  if (numScore < 0 || score === null || score === undefined || score === "" || isNaN(numScore)) {
    values.push("-");
    return;
  }
  const cleanScore = toIntString(score);
  const cleanMaxScore = toIntString(maxScore);
  if (!cleanScore || !cleanMaxScore) {
    values.push("✖");
    return;
  }
  assessments.push({ score: numScore, maxScore: Number(cleanMaxScore) });
  values.push(`${cleanScore}/${cleanMaxScore}`);
}

function evaluationKind(evaluation) {
  const label = `${evaluation.shortName ?? ""} ${evaluation.name ?? ""}`;
  if (/СОР|\bSOR\b/iu.test(label)) return "sor";
  if (/СОЧ|\bSOCH\b/iu.test(label)) return "soch";
  if (String(evaluation.type) === "2") return "sor";
  if (String(evaluation.type) === "1") return "soch";
  return "other";
}

function exactGrade(value) {
  if (value == null || String(value).trim() === "" || /^none$/i.test(String(value).trim())) return null;
  const numeric = Number(String(value).replace(",", "."));
  return Number.isFinite(numeric) ? numeric : value;
}

function assessmentScores(evaluation) {
  const score = exactGrade(evaluation.score);
  const maxScore = exactGrade(evaluation.maxScore);
  return {
    name: evaluation.name || null,
    score,
    maxScore,
    percent: typeof score === "number" && typeof maxScore === "number" && maxScore > 0
      ? Number((100 * score / maxScore).toFixed(2)) : null,
    comment: evaluation.comment || null,
    description: evaluation.description || null,
    disabled: evaluation.disabled === "" ? null : evaluation.disabled ?? null,
  };
}

export function formatSubject(subject) {
  const sors = [];
  const sochs = [];
  const sorAssessments = [];
  const sochAssessments = [];
  const assessments = [];

  for (const evaluation of subject.evaluations ?? []) {
    const kind = evaluationKind(evaluation);
    assessments.push({
      ...assessmentScores(evaluation),
      kind,
      shortName: evaluation.shortName || null,
      sourceType: evaluation.type || null,
      evaluationType: evaluation.evaluationType ?? null,
      reportedPercent: exactGrade(evaluation.percent),
      maxScores: evaluation.maxScores ?? null,
      formula: evaluation.formula ?? null,
      canExclude: evaluation.canExclude ?? null,
      criteria: (evaluation.subEvals ?? []).map(assessmentScores),
    });
    if (kind !== "sor" && kind !== "soch") continue;

    const values = kind === "sor" ? sors : sochs;
    const contributions = kind === "sor" ? sorAssessments : sochAssessments;
    const namedCriteria = evaluation.subEvals?.filter(item => item.name);
    if (namedCriteria?.length) {
      for (const subEvaluation of namedCriteria) {
        appendEvaluationValue(
          values,
          contributions,
          subEvaluation.score,
          subEvaluation.maxScore,
        );
      }
    } else {
      appendEvaluationValue(values, contributions, evaluation.score, evaluation.maxScore);
    }
  }

  const summary = summarizeWeightedAssessments(sorAssessments, sochAssessments);
  const hasAssessments = sorAssessments.length > 0 || sochAssessments.length > 0;
  const rawScore = exactGrade(subject.score);
  const rawMark = exactGrade(subject.mark);
  const validTotalPercent = (typeof rawScore === "number" && rawScore > 0)
    ? rawScore
    : (hasAssessments && typeof summary.calcTotal === "number" && summary.calcTotal > 0 ? summary.calcTotal : null);
  const validMark = (validTotalPercent !== null && typeof rawMark === "number" && rawMark > 0)
    ? toIntString(rawMark)
    : "-";

  return {
    subject: subject.name,
    sors: sors.concat(Array(Math.max(0, 4 - sors.length)).fill("-")),
    sochs: sochs.concat(Array(Math.max(0, 4 - sochs.length)).fill("-")),
    ...summary,
    total: validTotalPercent !== null ? (toDecimalString(validTotalPercent) ?? "-") : "-",
    mark: validMark,
    totalPercent: validTotalPercent,
    reportedMark: validTotalPercent !== null && typeof rawMark === "number" && rawMark > 0 ? rawMark : null,
    markComment: subject.markComment || null,
    assessments,
  };
}

async function fetchStudentProfile(client, schoolYearId, periods) {
  if (!periods.length) return { fullName: "", className: "" };
  try {
    const periodId = periods[0].Id;
    const parallels = (
      await client.postJson(
        "/JceDiary/GetParallels",
        { schoolYearId, periodId },
        { retries: 1, timeoutMs: 12000 },
      )
    ).data;
    if (!Array.isArray(parallels) || !parallels.length) return { fullName: "", className: "" };

    const klasses = (
      await client.postJson(
        "/JceDiary/GetKlasses",
        { schoolYearId, periodId, parallelId: parallels[0].Id },
        { retries: 1, timeoutMs: 12000 },
      )
    ).data;
    if (!Array.isArray(klasses) || !klasses.length) return { fullName: "", className: "" };

    const students = (
      await client.postJson(
        "/JceDiary/GetStudents",
        { schoolYearId, periodId, klassId: klasses[0].Id },
        { retries: 1, timeoutMs: 12000 },
      )
    ).data;
    return {
      fullName: Array.isArray(students) && students.length ? buildStudentName(students[0]) : "",
      className: buildClassName(klasses[0]),
    };
  } catch {
    return { fullName: "", className: "" };
  }
}

function enrichProfileFromLastProfile(client, profile) {
  return {
    fullName: profile.fullName || buildStudentName(client.lastProfile?.studentRaw),
    className: profile.className || buildClassName(client.lastProfile?.classRaw),
  };
}

function createEmptyGrades() {
  return { quarter1: [], quarter2: [], quarter3: [], quarter4: [], report: [] };
}

function hasGradeData(grades) {
  return Object.values(grades).some((rows) => Array.isArray(rows) && rows.length);
}

export function formatReportCardRow(row) {
  return applyLanguageLiteratureFinalGrade({
    subject: String(row.subjectName ?? "").trim(),
    component: row.componentName || null,
    evaluationSystem: row.evaluationSystemName || null,
    evaluationType: row.evaluationType ?? null,
    componentType: row.componentType ?? null,
    exempt: row.exempt ?? null,
    notChosen: row.notChosen ?? null,
    q1: normalizeNumbersInsideText(row.periods?.[0]),
    q2: normalizeNumbersInsideText(row.periods?.[1]),
    q3: normalizeNumbersInsideText(row.periods?.[2]),
    q4: normalizeNumbersInsideText(row.periods?.[3]),
    firstHalf: normalizeNumbersInsideText(row.halfYears?.[0]),
    secondHalf: normalizeNumbersInsideText(row.halfYears?.[1]),
    exam: normalizeNumbersInsideText(row.exam),
    year: normalizeNumbersInsideText(row.year),
    final: normalizeNumbersInsideText(row.final),
    reportedGrades: row.reportedGrades ?? null,
  });
}

async function getPeriodsWithRetry(client, schoolYearId, pushTrace) {
  let periods = await client.getPeriods(schoolYearId);
  pushTrace("periods_first_try", { schoolYearId, count: periods.length });
  if (!periods.length) {
    await sleep(400);
    periods = await client.getPeriods(schoolYearId);
    pushTrace("periods_second_try", { schoolYearId, count: periods.length });
  }
  return [...periods].sort((a, b) => String(a.Name ?? "").localeCompare(String(b.Name ?? "")));
}

function quarterViews(periods) {
  return periods.slice(0, 4).map((period, index) => {
    const quarter = /^\s*([1-4])\b/.exec(String(period.Name ?? ""));
    const number = quarter ? Number(quarter[1]) : index + 1;
    return { period, view: QUARTER_KEYS[number - 1], label: `${number}-я четверть` };
  });
}

function formatGrades(diaryByPeriodId, periods, reportCard) {
  const grades = createEmptyGrades();
  for (const { period, view } of quarterViews(periods)) {
    grades[view] = (diaryByPeriodId.get(period.Id) ?? []).map(formatSubject);
  }

  grades.report = reportCard.map(formatReportCardRow);
  return grades;
}

function buildYearPayload(year, yearProfile, grades) {
  return {
    key: year.key,
    schoolYearId: String(year.Id ?? ""),
    schoolYearName: String(year.Name ?? ""),
    className: yearProfile.className || year.inferredClassName,
    gradeNumber: year.gradeNumber,
    isCurrent: year.isCurrent,
    grades,
  };
}

function normalizeViewKey(view) {
  if (view === "report") return "report";
  return QUARTER_KEYS.includes(view) ? view : "quarter1";
}

async function scrapeSchoolYearView({
  client,
  year,
  targetView,
  periods: providedPeriods,
  pushTrace,
  reportProgress,
}) {
  const viewKey = normalizeViewKey(targetView);
  const progress = (fraction, status) =>
    reportProgress(18 + 76 * fraction, status, {
      schoolYearId: year.Id,
      schoolYearName: year.Name ?? "",
      className: year.inferredClassName,
      view: viewKey,
    });

  progress(0.02, `Обновляем ${viewKey === "report" ? "табель" : viewKey}`);
  const periods = providedPeriods ?? (await getPeriodsWithRetry(client, year.Id, pushTrace));
  pushTrace("single_view_periods_ready", { yearId: year.Id, count: periods.length, view: viewKey });

  const grades = createEmptyGrades();
  let yearProfile = { fullName: "", className: year.inferredClassName };

  if (viewKey === "report") {
    progress(0.25, "Загружаем табель");
    const reportCard = await client.getReportCard(year.Id);
    pushTrace("single_view_report_loaded", { yearId: year.Id, rowsCount: reportCard.length });
    grades.report = reportCard.map(formatReportCardRow);
    progress(1, "Табель обновлён");
    return buildYearPayload(year, yearProfile, grades);
  }

  const period = quarterViews(periods).find(({ view }) => view === viewKey)?.period;
  if (!period) {
    progress(1, "Нужная четверть не найдена");
    return buildYearPayload(year, yearProfile, grades);
  }

  progress(0.25, `Загружаем ${viewKey}`);
  const subjects = await client.getDiaryData(period.Id, year.Id, { skipDetails: true });
  yearProfile = {
    fullName: buildStudentName(client.lastProfile?.studentRaw) || "",
    className: buildClassName(client.lastProfile?.classRaw) || year.inferredClassName,
  };
  pushTrace("single_view_subjects_loaded", {
    yearId: year.Id,
    periodId: period.Id,
    subjectsCount: subjects.length,
    view: viewKey,
  });

  if (subjects.length) {
    await client.fetchAllSubjectDetails(subjects, {
      onSubjectComplete: ({ completed, total }) => {
        progress(0.35 + (0.6 * completed) / total, `Предметы ${completed}/${total}`);
      },
    });
  }

  grades[viewKey] = subjects.map(formatSubject);
  progress(1, `${viewKey} обновлена`);
  return buildYearPayload(year, yearProfile, grades);
}

async function scrapeSchoolYear({
  client,
  year,
  periods: providedPeriods,
  pushTrace,
  reportProgress,
  yearIndex,
  yearCount,
}) {
  const rangeStart = 18 + (yearIndex / yearCount) * 76;
  const rangeSize = 76 / yearCount;
  const progress = (fraction, status) =>
    reportProgress(rangeStart + rangeSize * fraction, status, {
      schoolYearId: year.Id,
      schoolYearName: year.Name ?? "",
      className: year.inferredClassName,
    });

  progress(0.02, `Загружаем ${year.inferredClassName}: учебный год ${year.Name ?? ""}`);
  const periods = providedPeriods ?? (await getPeriodsWithRetry(client, year.Id, pushTrace));
  pushTrace("year_periods_ready", { yearId: year.Id, count: periods.length });

  const diaryByPeriodId = new Map();
  const allSubjects = [];
  let yearProfile = { fullName: "", className: year.inferredClassName };
  const recordQuarter = (period, subjects, profile) => {
    diaryByPeriodId.set(period.Id, subjects);
    allSubjects.push(...subjects);
    yearProfile = {
      fullName: yearProfile.fullName || buildStudentName(profile?.studentRaw),
      className: buildClassName(profile?.classRaw) || yearProfile.className,
    };
    pushTrace("period_subjects_loaded", {
      yearId: year.Id,
      periodId: period.Id,
      subjectsCount: subjects.length,
    });
  };

  let parallelComplete = false;
  if (client instanceof SushClient && periods.length > 1 && periods.length <= 4) {
    let completed = 0;
    // The login is shared, but each iframe receives its own diary cookie and context.
    const results = await Promise.allSettled(periods.map(async (period) => {
      const diary = client.forkDiarySession();
      const subjects = await diary.getDiaryData(period.Id, year.Id);
      const sessionId = diary.getCookies().get("Aktobe_jce_SessionID");
      if (subjects.length && !sessionId) throw new Error("СУШ не создал отдельную сессию дневника.");
      completed++;
      progress(0.08 + (0.77 * completed) / periods.length,
        `${year.inferredClassName}: загружено ${completed} из ${periods.length} четвертей`);
      return { period, subjects, profile: diary.lastProfile, sessionId };
    }));
    const loaded = results.filter(entry => entry.status === "fulfilled").map(entry => entry.value);
    const sessionIds = loaded.map(entry => entry.sessionId).filter(Boolean);
    parallelComplete = loaded.length === periods.length && new Set(sessionIds).size === sessionIds.length;
    if (parallelComplete) {
      for (const { period, subjects, profile } of loaded) recordQuarter(period, subjects, profile);
    } else {
      pushTrace("parallel_diaries_retry_sequentially", { yearId: year.Id });
    }
  }

  if (!parallelComplete) {
    for (const [periodIndex, period] of periods.entries()) {
      const subjects = await client.getDiaryData(period.Id, year.Id, { skipDetails: true });
      recordQuarter(period, subjects, client.lastProfile);
      progress(0.08 + (0.24 * (periodIndex + 1)) / Math.max(periods.length, 1),
        `${year.inferredClassName}: загружено ${periodIndex + 1} из ${periods.length} четвертей`);
    }
  }

  if (!parallelComplete && allSubjects.length) {
    pushTrace("subject_details_fetch_start", { yearId: year.Id, subjectsCount: allSubjects.length });
    await client.fetchAllSubjectDetails(allSubjects, {
      onSubjectComplete: ({ completed, total }) => {
        progress(0.32 + (0.53 * completed) / total, `${year.inferredClassName}: оценки по предметам ${completed}/${total}`);
      },
    });
    pushTrace("subject_details_fetch_done", { yearId: year.Id, subjectsCount: allSubjects.length });
  } else if (!allSubjects.length) {
    progress(0.85, `${year.inferredClassName}: оценки по четвертям не найдены`);
  }

  progress(0.9, `${year.inferredClassName}: загружаем табель`);
  const reportCard = await client.getReportCard(year.Id);
  pushTrace("report_card_loaded", { yearId: year.Id, rowsCount: reportCard.length });
  const grades = formatGrades(diaryByPeriodId, periods, reportCard);
  progress(1, `${year.inferredClassName}: учебный год обработан`);

  return {
    key: year.key,
    schoolYearId: String(year.Id ?? ""),
    schoolYearName: String(year.Name ?? ""),
    className: yearProfile.className || year.inferredClassName,
    gradeNumber: year.gradeNumber,
    isCurrent: year.isCurrent,
    grades,
  };
}

/**
 * @param {{ iin?: string, password?: string, mode?: string, targetView?: string, targetYearId?: string | number, chooseScope?: (years: { Name: string, Id: string | number }[], getQuarterViews: Function) => Promise<{ yearId?: string | number, view?: string }>, client?: SushClient, onProgress?: Function, captcha?: string, sessionToken?: string }} [options]
 * @returns {Promise<{ success: boolean, debug: { trace: { step: string }[] }, captchaRequired?: boolean, profile?: { fullName: string, className: string }, years?: string[], grades?: unknown }>}
 */
export async function scrapeSush({
  iin,
  password,
  mode = "full",
  targetView,
  targetYearId,
  chooseScope,
  client = new SushClient(),
  onProgress,
  captcha,
  sessionToken,
} = {}) {
  const startedAt = Date.now();
  const trace = [];
  const pushTrace = (step, fields = {}) => {
    trace.push({ tMs: Date.now() - startedAt, step, ...fields });
  };
  const result = (success, extra = {}) => ({
    success,
    debug: { mode, durationMs: Date.now() - startedAt, trace },
    ...extra,
  });
  const reportProgress = (progress, status, extra = {}) => {
    onProgress?.({
      progress: Math.max(1, Math.min(99, Math.round(progress))),
      status,
      ...extra,
    });
  };

  try {
    if (sessionToken) {
      const restoredCookies = decodeSessionToken(sessionToken);
      if (restoredCookies) {
        client.setCookies(restoredCookies);
        pushTrace("session_restored");
      }
    }

    pushTrace("start", { iinTail: String(iin ?? "").slice(-4) });
    reportProgress(3, "Подключаемся к СУШ");
    const loginResult = await client.login(iin, password, captcha);

    if (loginResult.captchaRequired) {
      pushTrace("captcha_required", { captchaType: loginResult.captchaType });
      const newSessionToken = encodeSessionToken(client.getCookies());
      return result(false, {
        captchaRequired: true,
        captchaType: loginResult.captchaType,
        captchaData: loginResult.captchaData,
        sessionToken: newSessionToken,
        message: loginResult.message,
      });
    }

    if (!loginResult.success) {
      pushTrace("login_failed", { message: loginResult.message });
      return result(false, { message: loginResult.message });
    }
    pushTrace("login_ok");
    reportProgress(8, "Вход выполнен, ищем учебные годы");

    let years = await client.getSchoolYears();
    pushTrace("school_years_first_try", { count: years.length });
    if (!years.length) {
      await sleep(600);
      years = await client.getSchoolYears();
      pushTrace("school_years_second_try", { count: years.length });
    }

    const actualYear = years.find((year) => year.IsActual) ?? years[0];
    if (!actualYear) return result(false, { message: "No school year found" });
    pushTrace("actual_year_selected", { yearId: actualYear.Id, yearName: actualYear.Name ?? "" });
    reportProgress(12, "Определяем текущий класс");

    const periods = await getPeriodsWithRetry(client, actualYear.Id, pushTrace);
    pushTrace("periods_ready", { yearId: actualYear.Id, count: periods.length });

    let profile = await fetchStudentProfile(client, actualYear.Id, periods);
    pushTrace("profile_prefetch", {
      hasFullName: Boolean(profile.fullName),
      hasClassName: Boolean(profile.className),
    });

    if (["profile", "profile_only", "only_profile"].includes(mode)) {
      if (periods.length && (!profile.fullName || !profile.className)) {
        try {
          await client.getDiaryData(periods[0].Id, actualYear.Id, { skipDetails: true });
          profile = enrichProfileFromLastProfile(client, profile);
          pushTrace("profile_prefetch_via_diary", {
            hasFullName: Boolean(profile.fullName),
            hasClassName: Boolean(profile.className),
          });
        } catch (error) {
          pushTrace("profile_prefetch_via_diary_failed", { error: error.message });
        }
      }
      if (!profile.fullName || !profile.className) {
        const fallbackProfile = await fetchStudentProfile(client, actualYear.Id, periods);
        profile = {
          fullName: profile.fullName || fallbackProfile.fullName,
          className: profile.className || fallbackProfile.className,
        };
      }
      reportProgress(100, "Профиль загружен");
      const selectedYears = selectSchoolYearsForImport(years, profile.className);
      const yearStrings = selectedYears
        .map((y) => {
          const m = String(y.Name || "").match(/20\d{2}/);
          return m ? m[0] : null;
        })
        .filter(Boolean);
      return result(true, { profile, years: yearStrings });
    }

    reportProgress(16, "Класс найден, определяем доступные годы");
    if (periods.length && (!profile.fullName || !profile.className)) {
      try {
        await client.getDiaryData(periods[0].Id, actualYear.Id, { skipDetails: true });
        profile = enrichProfileFromLastProfile(client, profile);
        pushTrace("profile_prefetch_via_diary_full", {
          hasFullName: Boolean(profile.fullName),
          hasClassName: Boolean(profile.className),
        });
      } catch (error) {
        pushTrace("profile_prefetch_via_diary_full_failed", { error: error.message });
      }
    }

    if (!profile.fullName || !profile.className) {
      const fallbackProfile = await fetchStudentProfile(client, actualYear.Id, periods);
      profile = {
        fullName: profile.fullName || fallbackProfile.fullName,
        className: profile.className || fallbackProfile.className,
      };
      pushTrace("profile_prefetch_fallback_full", {
        hasFullName: Boolean(profile.fullName),
        hasClassName: Boolean(profile.className),
      });
    }

    const selectedYears = selectSchoolYearsForImport(years, profile.className);
    pushTrace("school_years_selected", {
      count: selectedYears.length,
      years: selectedYears.map((year) => year.Name ?? ""),
    });

    const periodsByYear = new Map([[String(actualYear.Id), periods]]);
    const getYearPeriods = async (year) => {
      const key = String(year.Id);
      if (!periodsByYear.has(key)) periodsByYear.set(key, await getPeriodsWithRetry(client, year.Id, pushTrace));
      return periodsByYear.get(key);
    };
    let yearsToImport = selectedYears;
    if (chooseScope) {
      const scope = await chooseScope(selectedYears, async (year) => quarterViews(await getYearPeriods(year)));
      if (scope.yearId !== undefined) {
        const chosenYear = selectedYears.find(year => String(year.Id) === String(scope.yearId));
        if (!chosenYear) return result(false, { message: "Выбранный учебный год недоступен." });
        targetYearId = chosenYear.Id;
        if (scope.view === "year") yearsToImport = [chosenYear];
        else {
          mode = "view_refresh";
          targetView = scope.view;
        }
      }
    }

    if (mode === "view_refresh") {
      const requestedView = normalizeViewKey(targetView);
      const selectedYearForView =
        selectedYears.find((year) =>
          String(year.Id) === String(targetYearId) ||
          String(year.key) === String(targetYearId),
        ) ||
        selectedYears.find((year) => year.isCurrent) ||
        selectedYears[0];
      if (!selectedYearForView) {
        return result(false, { message: "No school year found for view refresh" });
      }

      const yearPatch = await scrapeSchoolYearView({
        client,
        year: selectedYearForView,
        targetView: requestedView,
        periods: await getYearPeriods(selectedYearForView),
        pushTrace,
        reportProgress,
      });
      if (selectedYearForView.isCurrent) {
        profile = {
          fullName: profile.fullName || buildStudentName(client.lastProfile?.studentRaw),
          className: profile.className || yearPatch.className,
        };
      }
      reportProgress(96, "Выбранный раздел обновлён");
      return result(true, {
        profile,
        patch: {
          targetView: requestedView,
          year: yearPatch,
        },
      });
    }

    const history = [];
    for (const [yearIndex, year] of yearsToImport.entries()) {
      const yearGrades = await scrapeSchoolYear({
        client,
        year,
        periods: await getYearPeriods(year),
        pushTrace,
        reportProgress,
        yearIndex,
        yearCount: yearsToImport.length,
      });
      if (year.isCurrent || hasGradeData(yearGrades.grades)) history.push(yearGrades);
      if (year.isCurrent) {
        profile = {
          fullName: profile.fullName || buildStudentName(client.lastProfile?.studentRaw),
          className: profile.className || yearGrades.className,
        };
      }
    }

    const currentYear = history.find((year) => year.isCurrent) ?? history[0];
    if (!history.some((year) => hasGradeData(year.grades))) {
      return result(false, { message: "СУШ не вернул ни одной строки оценок или табеля." });
    }
    const currentGrades = currentYear?.grades ?? createEmptyGrades();
    const grades = {
      ...currentGrades,
      currentYearKey: currentYear?.key ?? "",
      history,
    };

    pushTrace("grades_ready", { years: history.length });
    reportProgress(96, "Все доступные классы загружены");
    return result(true, { grades, profile });
  } catch (error) {
    if (error.name === "AbortError" && chooseScope) throw error;
    pushTrace("exception", { error: error.message });
    return result(false, { message: `Server Error: ${error.message}` });
  }
}

