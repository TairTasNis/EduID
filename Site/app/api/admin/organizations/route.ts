import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { failure, HttpError, json } from '@/lib/server/http';

export const runtime = 'nodejs';

const ADMIN_EMAIL = 'tasmuhambetovtair@gmail.com';

async function checkAdmin(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Необходима авторизация.');
  const token = authHeader.slice(7);
  const { auth, db } = firebaseAdmin();
  const decoded = await auth.verifyIdToken(token);
  if (decoded.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new HttpError(403, 'Доступ запрещён. Требуются права администратора.');
  }
  return { auth, db };
}

export async function GET(request: Request) {
  try {
    const { db } = await checkAdmin(request);
    const snap = await db.ref('organizations').once('value');
    const orgsData = snap.val() || {};

    const list = Object.entries(orgsData).map(([uid, org]: [string, any]) => ({
      uid,
      name: org?.name || 'Организация',
      businessId: org?.businessId || '',
      type: org?.type || 'company',
      email: org?.email || '',
      phone: org?.phone || '',
      representative: org?.representative || '',
      position: org?.position || '',
      proofUrl: org?.proofUrl || '',
      status: org?.status || 'unverified',
      verified: Boolean(org?.verified),
      hasSubscription: Boolean(org?.hasSubscription),
      submittedAt: org?.submittedAt || Date.now(),
    }));

    list.sort((a, b) => b.submittedAt - a.submittedAt);
    return json({ ok: true, organizations: list });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(request: Request) {
  try {
    const { db } = await checkAdmin(request);
    const body = await request.json();
    const { action, orgUid, verified, hasSubscription } = body;

    if (!orgUid) throw new HttpError(400, 'Не указан UID организации.');

    const orgRef = db.ref(`organizations/${orgUid}`);
    const statusRef = db.ref(`organizationStatus/${orgUid}`);

    if (action === 'set_verification') {
      const isVerified = Boolean(verified);
      const newStatus = isVerified ? 'verified' : 'unverified';
      await orgRef.update({ verified: isVerified, status: newStatus });
      await statusRef.update({ verified: isVerified, status: newStatus });
      return json({ ok: true, status: newStatus, verified: isVerified });
    } else if (action === 'set_subscription') {
      const isSub = Boolean(hasSubscription);
      await orgRef.update({ hasSubscription: isSub });
      await statusRef.update({ hasSubscription: isSub });
      return json({ ok: true, hasSubscription: isSub });
    } else {
      throw new HttpError(400, 'Некорректное действие.');
    }
  } catch (err) {
    return failure(err);
  }
}
