import { firebaseAdmin } from '@/lib/server/firebase-admin';
import { failure, json } from '@/lib/server/http';

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
    if (ach.status === 'verified' || typeof ach.score === 'number') {
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

function calculateOverallAverage(grades: any): number | null {
  if (!grades || typeof grades !== 'object') return null;
  const percentages: number[] = [];
  for (const year of Object.keys(grades)) {
    let yearData = grades[year];
    if (typeof yearData === 'string') {
      try { yearData = JSON.parse(yearData); } catch { continue; }
    }
    if (!yearData) continue;

    for (const q of ['quarter1', 'quarter2', 'quarter3', 'quarter4']) {
      const rows = yearData.grades?.[q] || yearData[q];
      if (Array.isArray(rows)) {
        for (const s of rows) {
          if (typeof s?.totalPercent === 'number' && !isNaN(s.totalPercent) && s.totalPercent > 0) {
            percentages.push(Math.round(s.totalPercent));
          }
        }
      }
    }

    if (Array.isArray(yearData.periods)) {
      for (const p of yearData.periods) {
        if (Array.isArray(p.subjects)) {
          for (const s of p.subjects) {
            if (typeof s?.totalPercent === 'number' && s.totalPercent > 0) {
              percentages.push(Math.round(s.totalPercent));
            }
          }
        }
      }
    }
  }
  if (!percentages.length) return null;
  return Math.round(percentages.reduce((a, b) => a + b, 0) / percentages.length);
}

export async function GET(request: Request) {
  try {
    let currentUid: string | null = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const { auth } = firebaseAdmin();
        const decoded = await auth.verifyIdToken(token);
        currentUid = decoded.uid;
      } catch {
        // Continue
      }
    }

    const { db } = firebaseAdmin();
    const snap = await db.ref('students').once('value');
    const studentsData = snap.val() || {};

    const leaderboard: LeaderboardEntry[] = [];

    for (const [uid, student] of Object.entries(studentsData) as [string, any][]) {
      const profile = student?.profile;
      if (!profile?.fullName) continue;

      const name = profile.fullName;
      const classLabel = profile.classLabel || (profile.classNumber ? `${profile.classNumber} класс` : 'Ученик');
      const { score, count } = calculateScoreFromAchievements(student?.achievements);
      const talentScore = typeof profile?.talentScore === 'number' ? profile.talentScore : score;
      const averagePercent = calculateOverallAverage(student?.grades);

      const region = profile.region || (profile.source === 'sush' ? 'Актюбинская область' : 'г. Астана');

      leaderboard.push({
        uid,
        name,
        classLabel,
        region,
        talentScore,
        achievementsCount: count,
        averagePercent,
        isCurrentUser: uid === currentUid,
      });
    }

    leaderboard.sort((a, b) => {
      if (b.talentScore !== a.talentScore) return b.talentScore - a.talentScore;
      return (b.averagePercent ?? 0) - (a.averagePercent ?? 0);
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
