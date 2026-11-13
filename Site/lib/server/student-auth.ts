import 'server-only';
import { createHmac } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { firebaseConfig } from '../firebase-config';
import type { SchoolAccount } from './school-api';
import { configurationError, HttpError } from './http';

export function studentIdentity(account: SchoolAccount) {
  const key = process.env.EDUID_ID_HMAC_KEY;
  if (!key || key.length < 32) throw configurationError('EDUID_ID_HMAC_KEY');
  const uid = `student_${createHmac('sha256', key).update(`${account.source}:${account.login}`).digest('base64url')}`;
  const address = createHmac('sha256', key).update(`eduid-student-email\0${uid}`).digest('hex');
  const email = `${address}@students.eduid.invalid`;
  const password = createHmac('sha256', key).update(`eduid-student-auth\0${uid}\0${account.password}`).digest('hex');
  return { uid, email, password: `EduID1!${password}` };
}

type StudentIdentity = ReturnType<typeof studentIdentity>;

export async function studentAuthRecord(auth: Auth, uid: string) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw error;
  }
}

export async function provisionStudentAuth(auth: Auth, identity: StudentIdentity) {
  try {
    await auth.createUser(identity);
  } catch (error) {
    if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes((error as { code?: string }).code ?? '')) throw error;
    const user = await studentAuthRecord(auth, identity.uid);
    if (!user) throw error;
    if (user.disabled) throw new HttpError(403, 'Аккаунт EduID отключён.');
    if (!user.email) {
      await auth.updateUser(identity.uid, { email: identity.email, password: identity.password });
    } else if (user.email !== identity.email || !await verifyStudentPassword(identity)) {
      throw new HttpError(401, 'Проверьте логин и пароль EduID.');
    }
  }
}

export async function verifyStudentPassword({ uid, email, password }: StudentIdentity) {
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const emulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true' && process.env.VERCEL !== '1';
  const base = emulator && emulatorHost
    ? `http://${emulatorHost}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
  const key = emulator ? 'demo-eduid-key' : firebaseConfig.apiKey;
  const response = await fetch(`${base}/v1/accounts:signInWithPassword?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json();
  if (response.ok && result.localId === uid) return true;
  const code = result.error?.message;
  if (code === 'USER_DISABLED') throw new HttpError(403, 'Аккаунт EduID отключён.');
  if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER' || response.status === 429) {
    throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.');
  }
  if (['EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS'].includes(code)) return false;
  if (code === 'OPERATION_NOT_ALLOWED') throw configurationError('Firebase Authentication Email/Password');
  throw new HttpError(502, 'Firebase Auth не подтвердил вход. Попробуйте позже.');
}
