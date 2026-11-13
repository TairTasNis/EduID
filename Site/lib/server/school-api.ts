import 'server-only';
import { request } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import type { SchoolSource, StudentProfile } from '../contracts';
import { configurationError, HttpError } from './http';
import { scrapeSush } from './sush/scrape-sush.js';
import { SushClient } from './sush/sush-client.js';

export type SchoolAccount = { source: SchoolSource; login: string; password: string };
type SchoolProfileResponse = { fullName: string; className: string; years: string[] };
type GradeApiResult = { status: number; payload: { data?: unknown; code?: string } };

async function gradeApi(account: SchoolAccount, mode: 'profile' | 'history', year?: string, signal?: AbortSignal) {
  const { GRADE_API_URL, GRADE_API_KEY, GRADE_API_CA_PEM } = process.env;
  if (!GRADE_API_URL || !GRADE_API_KEY || !GRADE_API_CA_PEM) throw configurationError('GRADE_API_URL', 'GRADE_API_KEY', 'GRADE_API_CA_PEM');
  const endpoint = URL.canParse(GRADE_API_URL) ? new URL(GRADE_API_URL) : null;
  if (endpoint?.protocol !== 'https:' || endpoint.username || endpoint.password) throw configurationError('GRADE_API_URL');
  const body = Buffer.from(JSON.stringify({ ...account, mode, year }));
  const timeout = AbortSignal.timeout(mode === 'profile' ? 80_000 : 115_000);
  try {
    return await new Promise<GradeApiResult>((resolve, reject) => {
      const req = request(endpoint, {
        method: 'POST', ca: GRADE_API_CA_PEM.replaceAll('\\n', '\n'),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Authorization: `Basic ${Buffer.from(`vercel:${GRADE_API_KEY}`).toString('base64')}`,
          'Content-Type': 'application/json', 'Content-Length': body.length,
        },
      }, res => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 20 * 1024 * 1024) res.destroy(new Error('Grade API response too large'));
          else chunks.push(chunk);
        });
        res.once('error', reject);
        res.once('end', () => {
          const status = res.statusCode ?? 502;
          try { resolve({ status, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch { resolve({ status, payload: {} }); }
        });
      });
      req.once('error', reject);
      req.end(body);
    });
  } catch {
    throw new HttpError(502, 'Школьный сервис не ответил. Попробуйте ещё раз.');
  }
}

async function loadSchoolData(account: SchoolAccount, mode: 'profile' | 'history', year?: string, signal?: AbortSignal) {
  if (account.source === 'sush') {
    const client = new SushClient({
      baseUrl: 'https://sush.tasmukhambetov-t08.workers.dev',
      proxyUrl: '',
      fetchImpl: (url, options = {}) => fetch(url, {
        ...options,
        cache: 'no-store',
        signal: signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal,
      }),
    });
    const result = await scrapeSush({
      client,
      iin: account.login,
      password: account.password,
      mode: mode === 'profile' ? 'profile' : 'full',
      async chooseScope(years: { Name: string; Id: string | number }[]) {
        const target = years.find(item => String(item.Name).match(/20\d{2}/)?.[0] === year);
        if (!target) throw new HttpError(422, 'СУШ не предоставил данные за выбранный учебный год.');
        return { yearId: target.Id, view: 'year' };
      },
    });
    if (result.captchaRequired) {
      throw new HttpError(428, 'СУШ требует CAPTCHA для подключения EduID. Оценки доступны на школьном сайте.', 'sush_captcha_required');
    }
    if (result.success) {
      if (mode === 'profile') return { ...result.profile, years: result.years };
      if (result.grades) return result.grades;
    }
    if (result.debug.trace.some((event: { step: string }) => event.step === 'login_failed')) {
      throw new HttpError(422, 'СУШ отклонил вход. Проверьте ИИН и пароль.');
    }
    throw new HttpError(502, 'СУШ не вернул данные. Попробуйте позже.');
  }

  const source = 'BilimClass';
  let result = await gradeApi(account, mode, year, signal);
  if ([502, 503, 504].includes(result.status)) {
    await delay(1500, undefined, { signal });
    result = await gradeApi(account, mode, year, signal);
  }
  for (let attempt = 0; result.status === 429 && mode === 'history' && attempt < 3; attempt++) {
    await delay(2500 * (attempt + 1), undefined, { signal });
    result = await gradeApi(account, mode, year, signal);
  }
  if (result.status === 428 && result.payload.code === 'captcha_required') {
    throw new HttpError(428, `${source} запросил CAPTCHA. Откройте школьный сайт и проверьте, что можете войти там, затем повторите попытку в EduID.`);
  }
  if (result.status === 422) {
    throw new HttpError(422, mode === 'profile'
      ? `${source} не подтвердил профиль ученика. Проверьте данные для входа и выбранный сервис.`
      : `${source} не вернул данные за выбранный год.`);
  }
  if (result.status === 429) throw new HttpError(429, 'Школьный сервис занят другим запросом. Попробуйте через минуту.');
  if (result.status !== 200 || !result.payload.data) throw new HttpError(502, `${source} не вернул данные. Попробуйте позже.`);
  return result.payload.data;
}

export async function loadProfile(account: SchoolAccount) {
  const data = await loadSchoolData(account, 'profile') as Partial<SchoolProfileResponse>;
  const classLabel = typeof data.className === 'string' ? data.className.trim() : '';
  const match = /^(1[0-2]|[1-9])\s*[-–]?\s*[«"„]?\s*(\p{L})(?=[\s»"“]|$)/u.exec(classLabel);
  const fullName = typeof data.fullName === 'string' ? data.fullName.trim().replace(/\s+/g, ' ') : '';
  const years = Array.isArray(data.years)
    ? [...new Set(data.years.filter(year => typeof year === 'string' && /^20\d{2}$/.test(year)))].sort((a, b) => Number(b) - Number(a))
    : [];
  if (!fullName || !match || !years.length) throw new HttpError(422, 'Школьный сервис не вернул ФИО, класс или учебные годы.');
  const profile: StudentProfile = {
    fullName, classLabel, classNumber: Number(match[1]), classLetter: match[2].toUpperCase(), source: account.source,
  };
  return { profile, years };
}

export async function loadSchoolYear(account: SchoolAccount, year: string, signal: AbortSignal) {
  return loadSchoolData(account, 'history', year, signal);
}
