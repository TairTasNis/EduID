const CEILING_AVERAGE_SUBJECTS = new Set([
  "русский язык и литература",
  "казахский язык и литература",
]);

function normalizeSubjectName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ");
}

function parseQuarterGrade(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^[1-5](?:\.0+)?$/.test(normalized)) return null;
  return Number(normalized);
}

export function calculateLanguageLiteratureFinalGrade(row) {
  if (!CEILING_AVERAGE_SUBJECTS.has(normalizeSubjectName(row?.subject))) return null;

  const quarterGrades = [row?.q1, row?.q2, row?.q3, row?.q4].map(parseQuarterGrade);
  if (quarterGrades.some((grade) => grade === null)) return null;

  return String(Math.ceil(quarterGrades.reduce((sum, grade) => sum + grade, 0) / quarterGrades.length));
}

export function applyLanguageLiteratureFinalGrade(row) {
  const final = calculateLanguageLiteratureFinalGrade(row);
  return final === null ? row : { ...row, final };
}

export function normalizeReportRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(applyLanguageLiteratureFinalGrade);
}
