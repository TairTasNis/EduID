import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, configurationError } from './http';
import { normalizeSchoolProfile, type SchoolAccount } from './school-api';

export function verifySushProof(token: string | undefined, account: SchoolAccount) {
  const key = process.env.EDUID_SUSH_PROOF_KEY;
  if (!key || key.length < 32) throw configurationError('EDUID_SUSH_PROOF_KEY');
  const fail = () => { throw new HttpError(401, 'Не удалось подтвердить школьный профиль. Повторите регистрацию.'); };
  if (!token) return fail();
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return fail();
  const mac = (value: string) => createHmac('sha256', key).update(value).digest('base64url');
  const equal = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  if (!equal(signature, mac(`proof\0${encoded}`))) return fail();
  let proof: any;
  try { proof = JSON.parse(Buffer.from(encoded, 'base64url').toString()); } catch { return fail(); }
  if (proof.login !== account.login || typeof proof.credential !== 'string' || !equal(proof.credential, mac(`credential\0${account.login}\0${account.password}`)) || !Number.isSafeInteger(proof.exp) || proof.exp < Date.now() || proof.exp > Date.now() + 120000 || !/^[a-f0-9-]{36}$/.test(proof.nonce)) return fail();
  return { nonce: proof.nonce as string, school: normalizeSchoolProfile(account, { ...proof.profile, years: proof.years }) };
}
