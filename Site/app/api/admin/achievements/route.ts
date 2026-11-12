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
  return { auth, db, adminUid: decoded.uid };
}

export async function GET(request: Request) {
  try {
    const { db } = await checkAdmin(request);
    const snap = await db.ref('students').once('value');
    const studentsData = snap.val() || {};

    const list: Array<{
      studentUid: string;
      studentName: string;
      studentClass: string;
      achievement: any;
    }> = [];

    for (const [studentUid, student] of Object.entries(studentsData) as [string, any][]) {
      const profile = student?.profile;
      const studentName = profile?.fullName || 'Ученик';
      const studentClass = profile?.classLabel || (profile?.classNumber ? `${profile.classNumber} класс` : 'Ученик');
      const achievements = student?.achievements || {};

      for (const [achId, ach] of Object.entries(achievements) as [string, any][]) {
        if (!ach || typeof ach !== 'object') continue;
        list.push({
          studentUid,
          studentName,
          studentClass,
          achievement: {
            ...ach,
            id: achId,
          },
        });
      }
    }

    list.sort((a, b) => (Number(b.achievement.createdAt) || 0) - (Number(a.achievement.createdAt) || 0));
    return json({ ok: true, achievements: list });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(request: Request) {
  try {
    const { db } = await checkAdmin(request);
    const body = await request.json();
    const { action, studentUid, achievementId, score } = body;

    if (!studentUid || !achievementId) throw new HttpError(400, 'Не указаны данные ученика или достижения.');

    const achRef = db.ref(`students/${studentUid}/achievements/${achievementId}`);
    const achSnap = await achRef.get();
    if (!achSnap.exists()) throw new HttpError(404, 'Достижение не найдено.');
    const ach = achSnap.val();

    if (action === 'approve') {
      const awardedScore = Math.max(0, Math.min(1000, Number(score) || 0));
      await achRef.update({
        status: 'verified',
        score: awardedScore,
        reviewedAt: Date.now(),
      });

      // Пересчитываем суммарный talentScore профиля
      const allAchSnap = await db.ref(`students/${studentUid}/achievements`).get();
      const allAch = allAchSnap.val() || {};
      let totalTalentScore = 0;
      for (const a of Object.values(allAch) as any[]) {
        if (a?.status === 'verified' && typeof a?.score === 'number') {
          totalTalentScore += a.score;
        }
      }
      await db.ref(`students/${studentUid}/profile/talentScore`).set(totalTalentScore);

      // Отправляем уведомление ученику
      const notifRef = db.ref(`students/${studentUid}/notifications`).push();
      await notifRef.set({
        id: notifRef.key,
        title: 'Достижение подтверждено',
        message: `Ваше достижение «${ach.title}» одобрено модератором! Начислено ${awardedScore} баллов TalentScore.`,
        type: 'success',
        createdAt: Date.now(),
        read: false,
      });

      return json({ ok: true, status: 'verified', score: awardedScore });
    } else if (action === 'reject') {
      await achRef.update({
        status: 'rejected',
        reviewedAt: Date.now(),
      });

      // Отправляем уведомление ученику
      const notifRef = db.ref(`students/${studentUid}/notifications`).push();
      await notifRef.set({
        id: notifRef.key,
        title: 'Достижение отклонено',
        message: `Достижение «${ach.title}» не прошло верификацию модератором. Проверьте подлинность сертификата.`,
        type: 'error',
        createdAt: Date.now(),
        read: false,
      });

      return json({ ok: true, status: 'rejected' });
    } else {
      throw new HttpError(400, 'Некорректное действие.');
    }
  } catch (err) {
    return failure(err);
  }
}
