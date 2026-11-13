import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { failure, HttpError, json } from '@/lib/server/http';
import { leaderboardRevision, nextLeaderboardRevision } from '@/lib/server/leaderboard-revision';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Необходима авторизация.');
    const token = authHeader.slice(7);
    const { auth, db } = firebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;
    const body = await request.json();
    const { title, date, type, stage, place, photoUrl, photoSize } = body;
    if (!title || !date || !type || !stage || !place || !photoUrl) {
      throw new HttpError(400, 'Заполните все поля, укажите название и прикрепите фото сертификата.');
    }

    const newRef = db.ref(`students/${uid}/achievements`).push();
    const achievement = {
      id: newRef.key,
      title: String(title).trim(),
      date,
      type,
      stage,
      place,
      photoUrl,
      photoSize: Number(photoSize) || 0,
      status: 'unverified',
      createdAt: Date.now(),
    };
    await db.ref().update({
      [`students/${uid}/achievements/${newRef.key}`]: achievement,
      [leaderboardRevision]: nextLeaderboardRevision(),
    });

    // Добавляем уведомление в БД
    try {
      const notifRef = db.ref(`students/${uid}/notifications`).push();
      await notifRef.set({
        id: notifRef.key,
        title: 'Достижение отправлено на модерацию',
        message: `Сертификат «${achievement.title}» загружен и ожидает проверки модератором.`,
        type: 'warning',
        createdAt: Date.now(),
        read: false,
      });
    } catch {
      // ignore
    }

    return json({ ok: true, achievement });
  } catch (err) {
    return failure(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Необходима авторизация.');
    const token = authHeader.slice(7);
    const { auth, db } = firebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) throw new HttpError(400, 'Не указан ID достижения.');

    const achRef = db.ref(`students/${uid}/achievements/${id}`);
    const achSnap = await achRef.get();
    if (achSnap.exists()) {
      const ach = achSnap.val();
      const photoSize = Number(ach?.photoSize) || 0;
      if (photoSize > 0) {
        await db.ref('system/storageUsage').transaction((curr: number | null) => Math.max(0, (Number(curr) || 0) - photoSize));
      }
      await db.ref().update({
        [`students/${uid}/achievements/${id}`]: null,
        [leaderboardRevision]: nextLeaderboardRevision(),
      });
    }

    return json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
