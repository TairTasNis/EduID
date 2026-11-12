import { randomUUID } from 'node:crypto';
import { documentTypes, maxDocumentBytes, organizationInput } from '@/lib/contracts';
import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { assertSameOrigin, failure, HttpError, json } from '@/lib/server/http';
import { uploadToR2 } from '@/lib/server/r2-storage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw new HttpError(401, 'Войдите по почте организации.');
    if (Number(request.headers.get('content-length')) > maxDocumentBytes + 64 * 1024) throw new HttpError(413, 'Максимальный размер файла — 3 МБ.');
    const { auth, db } = firebaseAdmin();
    const user = await auth.verifyIdToken(token).catch(() => null);
    if (!user?.email || user.firebase.sign_in_provider !== 'password' || user.accountType === 'student') {
      throw new HttpError(401, 'Войдите по почте организации.');
    }
    const statusRef = db.ref(`organizationStatus/${user.uid}`);
    let form: FormData;
    try { form = await request.formData(); } catch { throw new HttpError(400, 'Форма заявки не прочиталась. Заполните её ещё раз.'); }
    const checked = organizationInput.safeParse({ ...Object.fromEntries(form), email: user.email });
    if (!checked.success) throw new HttpError(400, 'Проверьте БИН, почту и контактные данные.');

    const proof = form.get('proof');
    let proofUrl = '';
    if (proof instanceof File && proof.size > 0) {
      if (proof.size > maxDocumentBytes) {
        throw new HttpError(400, 'Приложите PDF, PNG или JPG до 3 МБ.');
      }
      const data = Buffer.from(await proof.arrayBuffer());
      const ext = proof.name.split('.').pop() || 'dat';
      const proofKey = `organizations/${user.uid}/${Date.now()}_proof.${ext}`;
      proofUrl = await uploadToR2(proofKey, data, proof.type || 'application/octet-stream');
    }

    const submittedAt = Date.now();
    const orgRecord = {
      uid: user.uid,
      name: checked.data.name,
      businessId: checked.data.businessId,
      type: checked.data.type,
      email: user.email,
      phone: checked.data.phone,
      representative: checked.data.representative,
      position: checked.data.position,
      proofUrl,
      status: 'unverified',
      verified: false,
      hasSubscription: false,
      submittedAt,
    };

    // Обновляем claims для аккаунта
    await auth.setCustomUserClaims(user.uid, { accountType: 'organization' });

    await db.ref().update({
      [`organizations/${user.uid}`]: orgRecord,
      [`organizationApplications/${user.uid}`]: orgRecord,
      [`organizationStatus/${user.uid}`]: {
        name: checked.data.name,
        representative: checked.data.representative,
        email: user.email,
        status: 'unverified',
        verified: false,
        hasSubscription: false,
        submittedAt,
      },
    });

    return json({ ok: true, status: 'unverified' }, 201);
  } catch (error) {
    return failure(error);
  }
}
