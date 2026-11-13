import { createHmac, randomBytes } from 'node:crypto';

const origin = 'https://www.bilimclass.kz';
const api = 'https://api.bilimclass.kz';
const diary = '/api/v4/os/clientoffice/diary';
const sessionKey = randomBytes(32);
const sessions = new Map();
const sessionTtl = 75_000;

export class BilimClassError extends Error {
  constructor(status, message, options) {
    super(message);
    this.status = status;
    this.options = options;
  }
}

async function request(host, path, { query, token, schoolId, login, journal } = {}) {
  const url = new URL(path, host);
  if (query) url.search = new URLSearchParams(query);
  const headers = { Accept: 'application/json', Origin: origin, 'X-Localization': 'ru' };
  if (schoolId) headers['X-School-Id'] = String(schoolId);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (journal) headers.external = '1';
  if (login) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method: login ? 'POST' : 'GET', headers, body: login ? JSON.stringify(login) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 429) throw new BilimClassError(429, 'BilimClass ограничил частоту запросов. Попробуйте позже.');
  if (login && [400, 401, 403, 422].includes(response.status)) {
    throw new BilimClassError(422, 'BilimClass отклонил вход. Проверьте логин и пароль.');
  }
  if (!response.ok) throw new BilimClassError(502, 'BilimClass не вернул данные.');
  return response.json();
}

const academicYear = year => `${year}-${Number(year) + 1}`;
const classKey = label => label.normalize('NFKC').toUpperCase().replace(/\s*(?:КЛАСС|СЫНЫП)\s*$/u, '').replace(/[\s-]/gu, '');
const schoolClass = /^(?:1[0-2]|[1-9])\s*[-–]?\s*[«"„]?\s*\p{L}[»"“]?(?:\s+(?:класс|сынып))?$/iu;
const round = value => Number(value.toFixed(2));
const gradeFor = percent => percent >= 85 ? 5 : percent >= 65 ? 4 : percent >= 40 ? 3 : 2;

function journalDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) throw new BilimClassError(502, 'BilimClass не вернул даты четверти.');
  const [, day, month, year] = match;
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

const labels = { regular: 'ФО', sor: 'СОР', soch: 'СОЧ', po: 'ПО' };
const kinds = { regular: 'formative', sor: 'sor', soch: 'soch', po: 'other' };
const attendanceLabels = { missing_without_reason: 'Н', missing_by_sick: 'Б', missing_due: 'У' };
const finalLabels = { unattestated: 'Временно не аттестован', not_certified: 'Н/А', exemption: 'Осв.', notstudy: 'Не изучал', mastered: 'Освоил', not_mastered: 'Не освоил' };

function finalGradeFor(row) {
  const score = String(row.finalScore ?? '').trim();
  if (row.scoreType === 'no_score') return 'Без оценки';
  if (row.scoreType === 'credit' && (score === '0' || score === '1')) return score === '1' ? 'Зачёт' : 'Незачёт';
  return /^[2-5]$/.test(score) ? Number(score) : finalLabels[score] ?? null;
}

function readSubject(row, marksBySchedule, poMode) {
  const marks = row.schedules.flatMap(({ uuid, type, markMax }) => {
    const journal = marksBySchedule[uuid];
    const mark = type === 'regular' ? journal?.formattedScore : journal?.[type];
    const value = mark?.mark ?? attendanceLabels[journal?.attendance];
    if (value == null) return [];
    const max = type === 'regular' ? null : mark?.markMax ?? markMax ?? null;
    return [{
      type: labels[type] ?? null, kind: kinds[type] ?? 'other', value, max,
      percent: typeof value === 'number' && max > 0 ? round(100 * value / max) : null,
    }];
  });
  const valid = marks.filter(mark => typeof mark.value === 'number' && mark.value >= 0);
  const regular = valid.filter(mark => mark.kind === 'formative');
  const formative = regular.length ? regular.reduce((sum, mark) => sum + mark.value, 0) / regular.length : null;
  const ratio = type => {
    const values = valid.filter(mark => mark.type === type && mark.max > 0);
    const max = values.reduce((sum, mark) => sum + mark.max, 0);
    return max ? 100 * values.reduce((sum, mark) => sum + mark.value, 0) / max : null;
  };
  let formativePercent = null;
  let sorPercent = null;
  let sochPercent = null;
  let poPercent = null;
  let totalPercent = null;
  let predictedGrade = null;
  if (poMode) {
    const po = ratio('ПО');
    formativePercent = formative === null ? null : round(formative * (po === null ? 10 : 5));
    poPercent = po === null ? null : round(po * 0.5);
    if (formativePercent !== null && poPercent !== null && !['credit', 'no_score'].includes(row.scoreType)) {
      totalPercent = round(formativePercent + poPercent);
    }
  } else if (formative !== null) {
    if (row.schedules.find(mark => mark.type === 'regular' && mark.markMax)?.markMax === 5) {
      predictedGrade = Math.round(formative);
    } else {
      const sor = ratio('СОР');
      const soch = sor === null ? null : ratio('СОЧ');
      formativePercent = round(formative * (sor === null ? 10 : soch === null ? 5 : 2.5));
      sorPercent = sor === null ? null : round(sor * (soch === null ? 0.5 : 0.25));
      sochPercent = soch === null ? null : round(soch * 0.5);
      totalPercent = round(formativePercent + (sorPercent ?? 0) + (sochPercent ?? 0));
      predictedGrade = gradeFor(Math.round(formative * (sor === null ? 10 : soch === null ? 5 : 2.5) +
        (sor ?? 0) * (soch === null ? 0.5 : 0.25) + (soch ?? 0) * 0.5));
    }
  }
  if (predictedGrade === null && totalPercent !== null) predictedGrade = gradeFor(Math.round(totalPercent));
  const finalGrade = finalGradeFor(row);
  return { subject: row.subjectName, marks, formativePercent, sorPercent, sochPercent, poPercent, totalPercent, predictedGrade, finalGrade };
}

async function authenticate(login, password) {
  const auth = await request(api, '/api/v2/os/login', { login: { login, password } });
  const user = auth.user_info;
  if (!auth.access_token || !user || user.show2factorModal) {
    throw new BilimClassError(422, 'BilimClass не подтвердил вход. Проверьте данные и дополнительное подтверждение в BilimClass.');
  }
  if (user.role !== 'student') throw new BilimClassError(422, 'Выберите учётную запись ученика BilimClass.');
  const years = [...new Set((user.school?.eduYears ?? [])
    .filter(year => ['active', 'archive'].includes(year.status) && /^20\d{2}$/.test(year.eduYear))
    .map(year => String(year.eduYear)))].sort((a, b) => Number(b) - Number(a));
  const currentYear = String(user.school?.eduYears?.find(year => year.isCurrent)?.eduYear ?? years[0]);
  const fullName = user.studentInfo?.fullname || [user.lastname, user.firstname, user.surname].filter(Boolean).join(' ');
  const className = user.group?.name;
  if (!fullName || !className || !years.length || !user.school_id) throw new BilimClassError(422, 'BilimClass не вернул профиль ученика.');
  return { user, accessToken: auth.access_token, currentYear, profile: { fullName, className, years } };
}

async function getSession(login, password, verify) {
  const now = Date.now();
  for (const [key, session] of sessions) if (now >= session.expiresAt) sessions.delete(key);
  const key = createHmac('sha256', sessionKey).update(JSON.stringify([login, password])).digest('hex');
  const previous = sessions.get(key);
  if (previous && !verify) return previous.data;
  sessions.delete(key);
  const data = await authenticate(login, password);
  if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
  sessions.set(key, { data, expiresAt: now + sessionTtl });
  return data;
}

function select(items, match, field) {
  const item = items.find(match);
  if (!item) throw new BilimClassError(422, `Выбранное значение ${field} недоступно.`, items.map(item => item.label));
  return item;
}

export async function importBilimClass(input) {
  const session = await getSession(input.login, input.password, input.mode === 'profile');
  const { user, accessToken, profile, currentYear } = session;
  if (input.mode === 'profile') return profile;
  const year = input.year ?? currentYear;
  if (!profile.years.includes(year)) throw new BilimClassError(422, 'Учебный год недоступен.', profile.years.map(academicYear));
  const query = { schoolId: user.school_id, eduYear: year };
  const options = { token: accessToken, schoolId: user.school_id };
  const [groupResponse, periodResponse] = await Promise.all([
    request(api, '/api/v4/os/clientoffice/group-list', { ...options, query }),
    request(api, `${diary}/periods`, { ...options, query }),
  ]);
  const groups = groupResponse.data;
  const periods = periodResponse.data?.periods;
  if (!Array.isArray(groups) || !Array.isArray(periods)) throw new BilimClassError(502, 'BilimClass не вернул классы или четверти.');
  const group = input.class !== undefined
    ? select(groups, group => classKey(group.label) === classKey(input.class), 'class')
    : groups.find(group => group.value === user.group?.id) ?? groups.find(group => schoolClass.test(group.label)) ?? groups[0];
  const quarters = periods.filter(p => p.periodType === 'quarter' && p.period >= 1 && p.period <= 4).sort((a, b) => a.period - b.period);
  if (input.mode === 'options') {
    return {
      classes: groups.map(item => item.label),
      currentClass: group?.label,
      quarters: quarters.map(period => period.period),
      currentQuarter: (quarters.find(period => period.isCurrent) ?? quarters[0])?.period,
    };
  }
  if (!group || !quarters.length) {
    if (input.mode === 'history') return { academicYear: academicYear(year), periods: [] };
    throw new BilimClassError(422, 'BilimClass не вернул доступные классы и четверти.');
  }
  const selected = input.mode === 'history' ? quarters : [input.quarter === undefined
    ? quarters.find(p => p.isCurrent) ?? quarters[0]
    : select(quarters.map(p => ({ ...p, label: `${p.period} четверть` })), p => p.period === input.quarter, 'quarter')];
  const groupUuids = [...new Set(user.studentInfo?.studentGroupUuids?.length
    ? user.studentInfo.studentGroupUuids : [user.studentInfo?.studentGroupUuid].filter(Boolean))];
  const journalHost = Number(year) <= 2025 ? 'https://journal-service-past.bilimclass.kz' : 'https://journal-service.bilimclass.kz';
  const poMode = Number(year) >= 2026 && [2, 3, 4].includes(Number.parseInt(group.label, 10));
  const data = [];
  for (const period of selected) {
    const { data: subjects } = await request(api, `${diary}/subjects`, {
      ...options, query: { ...query, groupId: group.value, period: period.period, periodType: 'quarter' },
    });
    if (!Array.isArray(subjects)) throw new BilimClassError(502, 'BilimClass не вернул предметы.');
    let marksBySchedule = {};
    if (subjects.some(subject => subject.schedules?.length)) {
      const earlier = period.period % 2 === 0 ? quarters.find(p => p.period === period.period - 1) : undefined;
      const dateFrom = journalDate(earlier?.periodStart ?? period.periodStart);
      const dateTo = journalDate(period.periodEnd);
      const journals = await Promise.all(groupUuids.map(studentGroupUuid => request(journalHost, '/diary/quarter', {
        schoolId: user.school_id, token: user.chatToken, journal: true,
        query: { ...query, userId: user.userId, studentGroupUuid, dateFrom, dateTo },
      })));
      if (journals.some(result => !result.data || typeof result.data !== 'object' ||
        (Array.isArray(result.data) && result.data.length))) {
        throw new BilimClassError(502, 'BilimClass не вернул оценки по занятиям.');
      }
      marksBySchedule = Object.assign({}, ...journals.map(result => result.data));
    }
    data.push({
      schemaVersion: 2, source: { name: 'BilimClass', url: `${origin}/${year}/summary-estimates?type=current` },
      academicYear: academicYear(year), class: group.label, quarter: period.period, exportedAt: new Date().toISOString(),
      subjects: subjects.map(row => readSubject({ ...row, schedules: row.schedules ?? [] }, marksBySchedule, poMode)),
    });
  }
  return input.mode === 'history' ? { academicYear: academicYear(year), periods: data } : data[0];
}
