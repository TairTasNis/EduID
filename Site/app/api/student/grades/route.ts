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
    const { year, grades, completed, total, currentCount } = body;
    if (!year || !grades) throw new HttpError(400, 'Отсутствуют данные оценок.');

    const gradeJson = typeof grades === 'string' ? grades : JSON.stringify(grades);
    if (Buffer.byteLength(gradeJson) > 9 * 1024 * 1024) throw new HttpError(413, 'Слишком большой размер оценок.');

    const updates: Record<string, any> = {
      [`students/${uid}/grades/${year}`]: gradeJson,
      [`students/${uid}/import/savedYears/${year}`]: true,
      [`students/${uid}/import/updatedAt`]: Date.now(),
      [leaderboardRevision]: nextLeaderboardRevision(),
    };

    if (typeof currentCount === 'number') {
      updates[`students/${uid}/import/completed`] = currentCount;
    }
    if (typeof total === 'number') {
      updates[`students/${uid}/import/total`] = total;
    }
    if (completed) {
      updates[`students/${uid}/import/status`] = 'complete';
      updates[`students/${uid}/import/message`] = null;
      updates[`students/${uid}/import/currentYear`] = null;
    } else {
      updates[`students/${uid}/import/status`] = 'running';
    }

    await db.ref().update(updates);

    if (completed) {
      const student = db.ref(`students/${uid}`);
      const notifRef = student.child('notifications').push();
      await notifRef.set({
        id: notifRef.key,
        title: 'Синхронизация оценок завершена',
        message: `Успешно загружены и проверены данные успеваемости за ${currentCount || 1} уч. года.`,
        type: 'success',
        createdAt: Date.now(),
        read: false,
      }).catch(() => {});
    }

    return json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
