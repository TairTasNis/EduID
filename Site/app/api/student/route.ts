import { createHmac } from 'node:crypto';
import { after } from 'next/server';
import { studentInput } from '@/lib/contracts';
import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { assertSameOrigin, configurationError, failure, HttpError, json } from '@/lib/server/http';
import { loadProfile } from '@/lib/server/school-api';
import { runImport, startImport } from '@/lib/server/student-import';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const deadline = Date.now() + 275_000;
  try {
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Откройте форму входа EduID.');
    if (Number(request.headers.get('content-length')) > 4096) throw new HttpError(413, 'Запрос слишком большой.');
    const body = await request.text();
    if (Buffer.byteLength(body) > 4096) throw new HttpError(413, 'Запрос слишком большой.');
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new HttpError(400, 'Проверьте данные формы.'); }
    const parsed = studentInput.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Проверьте логин или ИИН и пароль школьного сервиса.');
    const { action, source, login, password, consent } = parsed.data;
    if (action === 'register' && !consent) throw new HttpError(400, 'Подтвердите импорт оценок и данных школьного профиля.');
    const key = process.env.EDUID_ID_HMAC_KEY;
    if (!key || key.length < 32) throw configurationError('EDUID_ID_HMAC_KEY');
    const uid = `student_${createHmac('sha256', key).update(`${source}:${login}`).digest('base64url')}`;
    const { auth, db } = firebaseAdmin();

    const rate = await db.ref(`rateLimits/${uid}`).transaction((current: { count: number; since: number } | null) => {
      const now = Date.now();
      if (!current || now - current.since > 10 * 60_000) return { count: 1, since: now };
      if (current.count >= 6) return;
      return { ...current, count: current.count + 1 };
    });
    if (!rate.committed) throw new HttpError(429, 'Слишком много попыток. Попробуйте через 10 минут.');

    const account = { source, login, password };
    const { profile, years } = await loadProfile(account);
    const requestedRegion = String(parsed.data.region || '').trim() || (source === 'sush' ? 'Актюбинская область' : 'г. Астана');
    const enrichedProfile = { ...profile, region: requestedRegion };

    const profileRef = db.ref(`students/${uid}/profile`);
    const existing = (await profileRef.get()).exists();
    if (!existing && action === 'login') throw new HttpError(404, 'Аккаунт EduID ещё не создан. Откройте регистрацию.');
    if (existing && action === 'register') throw new HttpError(409, 'Аккаунт EduID уже создан. Откройте вход.');
    const token = await auth.createCustomToken(uid, { accountType: 'student' });
    if (existing) {
      await profileRef.update(profile);
    } else {
      const created = await profileRef.transaction(current => current ? undefined : {
        ...enrichedProfile, createdAt: Date.now(), importConsentAt: Date.now(), consentVersion: 1,
      });
      if (!created.committed) throw new HttpError(409, 'Аккаунт EduID уже создан. Откройте вход.');

      // Приветственное системное уведомление в БД
      try {
        const notifRef = db.ref(`students/${uid}/notifications`).push();
        await notifRef.set({
          id: notifRef.key,
          title: 'Добро пожаловать в EduID',
          message: `Профиль ${profile.fullName} успешно зарегистрирован в системе.`,
          type: 'info',
          createdAt: Date.now(),
          read: false,
        });
      } catch {
        // ignore
      }
    }
    const job = await startImport(db, uid, years);
    if (job) after(() => runImport(db, uid, account, job, deadline));
    return json({ token, profile: enrichedProfile });
  } catch (error) {
    return failure(error);
  }
}
