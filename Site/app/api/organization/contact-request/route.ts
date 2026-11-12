import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { failure, HttpError, json } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Необходима авторизация.');
    const token = authHeader.slice(7);
    const { auth, db } = firebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const orgUid = decoded.uid;

    const body = await request.json();
    const { studentUid } = body;
    if (!studentUid) throw new HttpError(400, 'Не указан ID ученика.');

    // Проверяем наличие подписки у организации
    const orgSnap = await db.ref(`organizations/${orgUid}`).get();
    const org = orgSnap.val();
    if (!org?.hasSubscription) {
      throw new HttpError(403, 'Для запроса контактов учеников требуется активная подписка (50 000 ₸). Оформите её во вкладке «Подписка».');
    }

    const orgName = org?.name || 'Организация';

    // Отправляем уведомление ученику с требованием подтверждения и почты родителя
    const notifRef = db.ref(`students/${studentUid}/notifications`).push();
    await notifRef.set({
      id: notifRef.key,
      title: `Запрос контактов от ${orgName}`,
      message: `Организация «${orgName}» проявила интерес к вашему портфолио и запросила контакты для связи. Для передачи данных требуется согласие и подтверждение через почту родителя.`,
      type: 'info',
      createdAt: Date.now(),
      read: false,
    });

    // Фиксируем запрос в базе данных ученика
    await db.ref(`students/${studentUid}/contactRequests/${orgUid}`).set({
      orgUid,
      orgName,
      requestedAt: Date.now(),
      status: 'pending_parent_confirmation',
    });

    return json({ ok: true, message: 'Запрос контактов успешно отправлен ученику.' });
  } catch (err) {
    return failure(err);
  }
}
