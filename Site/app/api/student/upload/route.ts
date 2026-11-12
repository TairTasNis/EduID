import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { failure, HttpError, json } from '@/lib/server/http';
import { MAX_PHOTO_BYTES, MAX_TOTAL_STORAGE_BYTES, uploadToR2 } from '@/lib/server/r2-storage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Необходима авторизация.');
    const token = authHeader.slice(7);
    const { auth, db } = firebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const formData = await request.formData();
    const file = formData.get('photo');
    if (!(file instanceof File) || !file.size) {
      throw new HttpError(400, 'Прикрепите фото сертификата.');
    }

    // 1. Лимит на 1 фото: до 2 МБ
    if (file.size > MAX_PHOTO_BYTES) {
      throw new HttpError(400, 'Размер одного фото не должен превышать 2 МБ.');
    }

    if (!file.type.startsWith('image/')) {
      throw new HttpError(400, 'Файл должен быть изображением (JPG, PNG, WebP).');
    }

    // 2. Лимит на общий объём всех фото: до 8 ГБ
    const storageRef = db.ref('system/storageUsage');
    const storageSnap = await storageRef.get();
    const currentStorageBytes = Number(storageSnap.val() || 0);

    if (currentStorageBytes + file.size > MAX_TOTAL_STORAGE_BYTES) {
      throw new HttpError(400, 'Общий объём всех загруженных фото превысил лимит в 8 ГБ. Загрузка отключена.');
    }

    // 3. Загрузка в Cloudflare R2
    const buffer = Buffer.from(await file.arrayBuffer());
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${uid}/${Date.now()}_${sanitizedName}`;
    const photoUrl = await uploadToR2(key, buffer, file.type || 'image/jpeg');

    // 4. Обновление общего счетчика хранилища
    await storageRef.transaction((current: number | null) => (Number(current) || 0) + file.size);

    return json({ photoUrl, photoSize: file.size });
  } catch (err) {
    return failure(err);
  }
}
