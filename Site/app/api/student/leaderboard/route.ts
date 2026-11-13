import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { failure, HttpError, json } from '@/lib/server/http';
import { averageSubjectPercent, parseGradesForPeriod } from '@/lib/student-grades';

export const runtime = 'nodejs';

export interface LeaderboardEntry {
  uid: string;
  name: string;
  classLabel: string;
  region?: string;
  talentScore: number;
  achievementsCount: number;
  averagePercent: number | null;
  isCurrentUser?: boolean;
}

function calculateScoreFromAchievements(achievements: any): { score: number; count: number } {
  if (!achievements || typeof achievements !== 'object') return { score: 0, count: 0 };
  let score = 0;
  let count = 0;
  for (const ach of Object.values(achievements) as any[]) {
    if (!ach || typeof ach !== 'object') continue;
    count++;
    if (ach.status === 'verified' || (!ach.status && typeof ach.score === 'number')) {
      const base = typeof ach.score === 'number' ? ach.score : (
        ach.stage === 'Всемирный' ? 300 :
        ach.stage === 'Республиканский' ? 200 :
        ach.stage === 'Сетевой' ? 150 :
        ach.stage === 'Областной' ? 100 :
        ach.stage === 'Городской' ? 75 : 50
      );
      score += base;
    }
  }
  return { score, count };
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, 'Войдите в EduID, чтобы открыть рейтинг.');
    const { auth, db } = firebaseAdmin();
    const { uid: currentUid } = await auth.verifyIdToken(authHeader.slice(7)).catch(() => {
      throw new HttpError(401, 'Войдите в EduID, чтобы открыть рейтинг.');
    });
    const snap = await db.ref('students').once('value');
    const studentsData = snap.val() || {};

    const leaderboard: LeaderboardEntry[] = [];

    for (const [uid, student] of Object.entries(studentsData) as [string, any][]) {
      const profile = student?.profile;
      if (!profile?.fullName) continue;

      const name = profile.fullName;
      const classLabel = profile.classLabel || (profile.classNumber ? `${profile.classNumber} класс` : 'Ученик');
      const { score, count } = calculateScoreFromAchievements(student?.achievements);
      const grades = student.grades ?? {};
      const source = profile.source === 'sush' ? 'sush' : 'bilimclass';
      const averagePercent = averageSubjectPercent(Object.keys(grades).map(year =>
        [1, 2, 3, 4].map(quarter => parseGradesForPeriod(grades, year, quarter, source))));

      const region = profile.region || (profile.source === 'sush' ? 'Актюбинская область' : 'г. Астана');

      leaderboard.push({
        uid,
        name,
        classLabel,
        region,
        talentScore: score,
        achievementsCount: count,
        averagePercent,
        isCurrentUser: uid === currentUid,
      });
    }

    leaderboard.sort((a, b) => {
      if (b.talentScore !== a.talentScore) return b.talentScore - a.talentScore;
      return (b.averagePercent ?? 0) - (a.averagePercent ?? 0) || a.uid.localeCompare(b.uid);
    });

    const currentUserEntry = currentUid ? leaderboard.find(e => e.uid === currentUid) : null;
    const userRank = currentUserEntry ? leaderboard.findIndex(e => e.uid === currentUid) + 1 : null;

    return json({
      ok: true,
      leaderboard,
      userRank,
      userTalentScore: currentUserEntry ? currentUserEntry.talentScore : 0,
      userAveragePercent: currentUserEntry?.averagePercent ?? null,
    });
  } catch (err) {
    return failure(err);
  }
}
