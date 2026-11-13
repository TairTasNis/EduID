import { after } from 'next/server';
import { studentInput } from '@/lib/contracts';
import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { assertSameOrigin, failure, HttpError, json } from '@/lib/server/http';
import { loadProfile } from '@/lib/server/school-api';
import { leaderboardRevision, nextLeaderboardRevision } from '@/lib/server/leaderboard-revision';
import { provisionStudentAuth, studentAuthRecord, studentIdentity, verifyStudentPassword } from '@/lib/server/student-auth';
import { runImport, startImport } from '@/lib/server/student-import';
import { verifySushProof } from '@/lib/server/sush-proof';

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
    const account = { source, login, password };
    const identity = studentIdentity(account);
    const { uid } = identity;
    const { auth, db } = firebaseAdmin();

    const limitSchoolAttempts = async () => {
      const rate = await db.ref(`rateLimits/${uid}`).transaction((current: { count: number; since: number } | null) => {
        const now = Date.now();
        if (!current || now - current.since > 10 * 60_000) return { count: 1, since: now };
        if (current.count >= 6) return;
        return { ...current, count: current.count + 1 };
      });
      if (!rate.committed) throw new HttpError(429, 'Слишком много проверок школьного аккаунта. Попробуйте через 10 минут.');
    };

    const student = db.ref(`students/${uid}`);
    const profileRef = student.child('profile');
    let profile = (await profileRef.get()).val();
    let years: string[] | undefined = profile?.schoolYears;
    if (action === 'login') {
      if (!profile) throw new HttpError(404, 'Аккаунт EduID ещё не создан. Откройте регистрацию.', 'registration_required');
      if (!await verifyStudentPassword(identity)) {
        const existing = await studentAuthRecord(auth, uid);
        if (existing?.disabled) throw new HttpError(403, 'Аккаунт EduID отключён.');
        if (existing?.email) throw new HttpError(401, 'Проверьте логин и пароль EduID.');
        await limitSchoolAttempts();
        const school = await loadProfile(account);
        await provisionStudentAuth(auth, identity);
        years = school.years;
        profile = { ...profile, ...school.profile, schoolYears: years };
        await db.ref().update({
          ...Object.fromEntries(Object.entries({ ...school.profile, schoolYears: years })
            .map(([field, value]) => [`students/${uid}/profile/${field}`, value])),
          [leaderboardRevision]: nextLeaderboardRevision(),
        });
      }
    } else {
      if (profile) throw new HttpError(409, 'Аккаунт EduID уже создан. Войдите с теми же данными.', 'account_exists');
      await limitSchoolAttempts();
      const verified = source === 'sush' ? verifySushProof(parsed.data.sushProof, account) : null;
      if (verified) {
        const consumed = await db.ref(`sushProofs/${verified.nonce}`).transaction(current => current ? undefined : Date.now());
        if (!consumed.committed) throw new HttpError(401, 'Подтверждение уже использовано. Повторите регистрацию.');
      }
      const school = verified ? verified.school : await loadProfile(account);
      years = school.years;
      const region = (parsed.data.region || '').trim() || (source === 'sush' ? 'Актюбинская область' : 'г. Астана');
      const now = Date.now();
      profile = { ...school.profile, region, schoolYears: years, createdAt: now, importConsentAt: now, consentVersion: 1 };
      await provisionStudentAuth(auth, identity);
      const created = await profileRef.transaction(current => current ? undefined : profile);
      if (!created.committed) throw new HttpError(409, 'Аккаунт EduID уже создан. Войдите с теми же данными.', 'account_exists');

      after(async () => {
        await db.ref(leaderboardRevision).set(nextLeaderboardRevision()).catch(() => {});
        const notifRef = student.child('notifications').push();
        await notifRef.set({
          id: notifRef.key,
          title: 'Добро пожаловать в EduID',
          message: `Профиль ${profile.fullName} успешно зарегистрирован в системе.`,
          type: 'info',
          createdAt: Date.now(),
          read: false,
        }).catch(() => {});
      });
    }
    const token = await auth.createCustomToken(uid, { accountType: 'student' });
    after(async () => {
      try {
        const job = await startImport(db, uid, years);
        if (job) await runImport(db, uid, account, job, deadline);
      } catch {
        console.error('EduID could not start the grade import');
      }
    });
    return json({ token, profile });
  } catch (error) {
    return failure(error);
  }
}
