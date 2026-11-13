'use client';

import { useEffect, useState, useMemo, useCallback, type FormEvent, type ReactNode, type ChangeEvent } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, reload, sendEmailVerification,
  signInWithCustomToken, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { onValue, push, ref, remove, update } from 'firebase/database';
import { corporateEmail, documentTypes, KAZAKHSTAN_REGIONS, maxDocumentBytes, organizationTypes, providers,
  type ImportStatus, type OrganizationStatus, type SchoolSource, type StudentProfile } from '@/lib/contracts';
import { auth, database } from '@/lib/firebase-browser';

type Mode = 'login' | 'register';
type Audience = 'student' | 'organization';
type Session = { user: User; kind: Audience };

type Achievement = {
  id: string;
  title: string;
  date: string;
  type: string;
  stage: string;
  place: string;
  photoUrl: string;
  photoSize?: number;
  status?: 'unverified' | 'verified';
  createdAt?: number;
};

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  createdAt?: number;
  read?: boolean;
}

interface LeaderboardItem {
  uid: string;
  name: string;
  classLabel: string;
  region?: string;
  talentScore: number;
  achievementsCount: number;
  averagePercent: number | null;
  isCurrentUser?: boolean;
}

type NormalizedSubject = {
  name: string;
  formativeMarks: string[];
  formativePercent: number | null;
  sorPercent: number | null;
  sochPercent: number | null;
  finalPercent: number | null;
  quarterGrade?: string | number | null;
};

function Logo() {
  return <span className="wordmark"><span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>EduID</span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Password({ organization, register }: { organization?: boolean; register?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="field">
    <label className="field-label" htmlFor="password">{organization ? 'Пароль EduID' : 'Пароль школьного сервиса'}</label>
    <div className="password-input">
      <input id="password" name="password" type={visible ? 'text' : 'password'} required maxLength={256}
        minLength={organization && register ? 8 : 1} autoComplete={organization && register ? 'new-password' : 'current-password'} placeholder="Введите пароль" />
      <button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={visible}>{visible ? 'Скрыть' : 'Показать'}</button>
    </div>
    {organization && register && <small>Минимум 8 символов.</small>}
  </div>;
}

function OrganizationFields() {
  const [file, setFile] = useState('');
  const [visible, setVisible] = useState(false);
  return <>
    <Field label="Юридическое название"><input name="name" placeholder="Название по учредительным документам" required minLength={2} maxLength={200} /></Field>
    <div className="field-grid">
      <Field label="БИН или ИИН для ИП"><input name="businessId" inputMode="numeric" placeholder="12 цифр" pattern="[0-9]{12}" maxLength={12} required /></Field>
      <Field label="Тип организации"><select name="type" defaultValue="" required>
        <option value="" disabled>Выберите тип</option>
        {Object.entries(organizationTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
    </div>
    <div className="field-grid">
      <Field label="Корпоративная почта"><input name="email" type="email" autoComplete="email" placeholder="name@company.kz" maxLength={254} required /></Field>
      <div className="field">
        <label className="field-label" htmlFor="org-reg-password">Пароль аккаунта</label>
        <div className="password-input">
          <input id="org-reg-password" name="password" type={visible ? 'text' : 'password'} required minLength={8} maxLength={256} autoComplete="new-password" placeholder="Минимум 8 символов" />
          <button type="button" onClick={() => setVisible(v => !v)} aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={visible}>{visible ? 'Скрыть' : 'Показать'}</button>
        </div>
        <small>Минимум 8 символов.</small>
      </div>
    </div>
    <div className="field-grid">
      <Field label="Рабочий телефон"><input name="phone" type="tel" autoComplete="tel" placeholder="+7 700 000 00 00" maxLength={24} required /></Field>
      <Field label="ФИО представителя"><input name="representative" autoComplete="name" placeholder="Фамилия Имя Отчество" required minLength={3} maxLength={140} /></Field>
    </div>
    <Field label="Должность"><input name="position" autoComplete="organization-title" placeholder="Должность представителя" required minLength={2} maxLength={120} /></Field>
    <label className="field"><span className="field-label">Подтверждение полномочий</span>
      <span className="upload"><span className="upload-icon" aria-hidden="true">↑</span><span><strong>{file || 'Прикрепите документ'}</strong><small>Доверенность или письмо на бланке. PDF, PNG или JPG до 3 МБ.</small></span>
        <input name="proof" type="file" accept={documentTypes.join(',')} required onChange={event => setFile(event.target.files?.[0]?.name ?? '')} />
      </span>
    </label>
  </>;
}

function IdentityArt({ organization }: { organization: boolean }) {
  return <aside className="identity" aria-label={organization ? 'EduID для организаций' : 'Учебный профиль EduID'}>
    <div className="identity-frame">
      <div className="identity-art" aria-hidden="true">
        <span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit orbit-three" />
        <div className="id-card">
          <div className="id-card-top"><span>EduID</span><span className="id-chip"><i /><i /><i /></span></div>
          <div className="id-card-person"><span className="portrait" /><div className="id-lines"><i /><i /><i /></div></div>
          <div className="id-card-bottom"><span>Учебный профиль</span><span className="id-bars" /></div>
        </div>
      </div>
      <div className="identity-text">{organization ? <><p>EduID для<br />организаций</p><span>Заявки и документы проверяются вручную.</span></>
        : <><p>Ваш учебный<br />профиль</p><span>Подключите школьный сервис, чтобы собрать историю оценок в EduID.</span></>}</div>
    </div>
  </aside>;
}

function Progress({ status, retry }: { status: ImportStatus; retry: () => void }) {
  const [hidden, setHidden] = useState(false);
  if (hidden && status.status === 'complete') return null;
  const percent = status.status === 'complete' ? 100 : Math.round(100 * status.completed / Math.max(status.total, 1));
  const title = { running: 'Импорт оценок', complete: 'Оценки импортированы', failed: 'Импорт приостановлен' }[status.status];
  return <aside className="progress-card" aria-live="polite">
    <div className="progress-top"><span className={`progress-icon ${status.status}`} aria-hidden="true">{status.status === 'complete' ? '✓' : '↓'}</span><strong>{title}</strong>
      {status.status === 'complete' && <button className="text-button close" type="button" aria-label="Закрыть уведомление" onClick={() => setHidden(true)}>×</button>}
    </div>
    <progress max={100} value={percent} aria-label="Доля загруженных учебных лет" />
    <div className="progress-detail"><span>Учебных лет {status.completed} из {status.total}</span><strong>{percent}%</strong></div>
    {status.status === 'running' && status.currentYear && <small>Загружаем {status.currentYear}–{Number(status.currentYear) + 1}</small>}
    {status.status === 'failed' && <><small>{status.message}</small><button className="text-button" onClick={retry}>Войти снова и продолжить</button></>}
  </aside>;
}

// Dynamic score coloring: 80 - 100% Green, 65 - 79% Yellow, < 65% Red
function getScoreClass(percent: number | null): string {
  if (percent === null) return '';
  if (percent >= 80) return 'score-green';
  if (percent >= 65) return 'score-yellow';
  return 'score-red';
}

function getFormativeClass(mark: unknown): string {
  if (mark === null || mark === undefined) return '';
  const str = typeof mark === 'object' ? String((mark as any).score ?? (mark as any).value ?? '') : String(mark);
  const num = parseFloat(str.replace(',', '.'));
  if (isNaN(num)) return '';
  const pct = num <= 10 ? num * 10 : num;
  if (pct >= 80) return 'score-green';
  if (pct >= 65) return 'score-yellow';
  return 'score-red';
}

function CircularGauge({ percent }: { percent: number | null }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const value = percent !== null ? Math.min(100, Math.max(0, percent)) : 0;
  const offset = circumference - (value / 100) * circumference;

  let color = '#94a3b8';
  if (percent !== null) {
    if (percent >= 80) color = '#16a34a'; // 80 - 100%: Green
    else if (percent >= 65) color = '#ca8a04'; // 65 - 79%: Yellow
    else color = '#dc2626'; // < 65%: Red
  }

  return (
    <div className="gauge-wrapper" aria-label={`Средний процент: ${percent !== null ? percent + '%' : 'нет данных'}`}>
      <svg className="gauge-svg" viewBox="0 0 86 86">
        <circle className="gauge-bg" cx="43" cy="43" r={radius} />
        <circle
          className="gauge-fill"
          cx="43"
          cy="43"
          r={radius}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={percent !== null ? offset : circumference}
        />
      </svg>
      <div className="gauge-text" style={{ color: percent !== null ? color : undefined }}>
        {percent !== null ? `${percent}%` : '—'}
      </div>
    </div>
  );
}

function parseRatioOrPercent(val: unknown): number | null {
  if (typeof val === 'number') return val >= 0 ? val : null;
  if (!val || typeof val !== 'string') return null;
  const str = val.trim();
  if (str === '-' || str === '✖' || str.startsWith('-')) return null;
  const ratioMatch = str.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (ratioMatch) {
    const s = parseFloat(ratioMatch[1].replace(',', '.'));
    const m = parseFloat(ratioMatch[2].replace(',', '.'));
    return m > 0 && s >= 0 ? (s / m) * 100 : null;
  }
  const pctMatch = str.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (pctMatch) {
    const p = parseFloat(pctMatch[1].replace(',', '.'));
    return p >= 0 ? p : null;
  }
  const num = parseFloat(str.replace(',', '.'));
  return !isNaN(num) && num >= 0 ? num : null;
}

function normalizeSubject(sub: any, source: SchoolSource): NormalizedSubject {
  const name = sub?.subject || sub?.name || 'Предмет';

  // ФО
  let formativeMarks: string[] = [];
  if (Array.isArray(sub?.marks)) {
    formativeMarks = sub.marks
      .map((m: any) => {
        if (m === null || m === undefined) return '';
        if (typeof m === 'object') return String(m.score ?? m.value ?? m.mark ?? '');
        return String(m);
      })
      .filter((s: string) => Boolean(s) && s !== '-');
  }
  const formativePercent = typeof sub?.formativePercent === 'number' ? sub.formativePercent : null;

  // СОР
  let sorPercent: number | null = null;
  if (typeof sub?.sorPercent === 'number' && sub.sorPercent >= 0) {
    sorPercent = sub.sorPercent;
  } else if (Array.isArray(sub?.evaluations)) {
    const sorEval = sub.evaluations.find((e: any) => e.shortName === 'СОР' || (typeof e.name === 'string' && e.name.includes('раздел')));
    if (sorEval) {
      const score = parseFloat(String(sorEval.score || '').replace(',', '.'));
      const maxScore = parseFloat(String(sorEval.maxScore || '').replace(',', '.'));
      if (maxScore > 0 && !isNaN(score) && score >= 0) {
        sorPercent = Math.round((score / maxScore) * 100);
      } else if (sorEval.percent) {
        sorPercent = parseRatioOrPercent(sorEval.percent);
      }
    }
  } else if (Array.isArray(sub?.sors)) {
    const valid = sub.sors.filter((s: any) => s !== '-' && s !== '✖' && s != null && !String(s).startsWith('-'));
    if (valid.length) {
      let totalSc = 0, totalMax = 0;
      for (const s of valid) {
        const parts = String(s).split('/');
        if (parts.length === 2) {
          const sc = parseFloat(parts[0]);
          const mx = parseFloat(parts[1]);
          if (sc >= 0 && mx > 0) {
            totalSc += sc;
            totalMax += mx;
          }
        }
      }
      if (totalMax > 0) sorPercent = Math.round((totalSc / totalMax) * 100);
    }
  }

  // СОЧ
  let sochPercent: number | null = null;
  if (typeof sub?.sochPercent === 'number' && sub.sochPercent >= 0) {
    sochPercent = sub.sochPercent;
  } else if (Array.isArray(sub?.evaluations)) {
    const sochEval = sub.evaluations.find((e: any) => e.shortName === 'СОЧ' || (typeof e.name === 'string' && e.name.includes('четверть')));
    if (sochEval) {
      const score = parseFloat(String(sochEval.score || '').replace(',', '.'));
      const maxScore = parseFloat(String(sochEval.maxScore || '').replace(',', '.'));
      if (maxScore > 0 && !isNaN(score) && score >= 0) {
        sochPercent = Math.round((score / maxScore) * 100);
      } else if (sochEval.percent) {
        sochPercent = parseRatioOrPercent(sochEval.percent);
      }
    }
  } else if (Array.isArray(sub?.sochs)) {
    const valid = sub.sochs.filter((s: any) => s !== '-' && s !== '✖' && s != null && !String(s).startsWith('-'));
    if (valid.length) {
      let totalSc = 0, totalMax = 0;
      for (const s of valid) {
        const parts = String(s).split('/');
        if (parts.length === 2) {
          const sc = parseFloat(parts[0]);
          const mx = parseFloat(parts[1]);
          if (sc >= 0 && mx > 0) {
            totalSc += sc;
            totalMax += mx;
          }
        }
      }
      if (totalMax > 0) sochPercent = Math.round((totalSc / totalMax) * 100);
    }
  }

  // Расчет итогового процента
  // Формула BilimClass: 25% ФО + 25% СОР + 50% СОЧ = Итоговый процент
  // Формула СУШ: 50% СОР + 50% СОЧ = Итоговый процент
  let finalPercent: number | null = null;

  if (source === 'bilimclass') {
    if (typeof sub?.totalPercent === 'number' && sub.totalPercent > 0) {
      finalPercent = Math.round(sub.totalPercent);
    } else {
      let sum = 0;
      let totalWeight = 0;
      if (formativePercent !== null && formativePercent > 0) {
        sum += formativePercent * 0.25;
        totalWeight += 0.25;
      }
      if (sorPercent !== null && sorPercent > 0) {
        sum += sorPercent * 0.25;
        totalWeight += 0.25;
      }
      if (sochPercent !== null && sochPercent > 0) {
        sum += sochPercent * 0.50;
        totalWeight += 0.50;
      }
      if (totalWeight > 0) {
        finalPercent = Math.round(sum / totalWeight);
      }
    }
  } else {
    // SUSH: 50% СОР + 50% СОЧ
    if (sorPercent !== null && sochPercent !== null) {
      finalPercent = Math.round(sorPercent * 0.50 + sochPercent * 0.50);
    } else if (sorPercent !== null && sochPercent === null) {
      finalPercent = Math.round(sorPercent);
    } else if (typeof sub?.totalPercent === 'number' && sub.totalPercent > 0) {
      finalPercent = Math.round(sub.totalPercent);
    } else if (sub?.score && !isNaN(parseFloat(sub.score)) && parseFloat(sub.score) > 0) {
      finalPercent = Math.round(parseFloat(sub.score));
    }
  }

  const rawGrade = sub?.quarterGrade ?? sub?.mark ?? null;
  const quarterGrade = (rawGrade === '0' || rawGrade === 0 || rawGrade === '-' || rawGrade === 'none') ? null : rawGrade;

  return {
    name,
    formativeMarks,
    formativePercent,
    sorPercent,
    sochPercent,
    finalPercent,
    quarterGrade,
  };
}

function parseGradesForPeriod(gradesMap: Record<string, unknown>, year: string, quarter: number, source: SchoolSource): NormalizedSubject[] {
  if (!gradesMap || !gradesMap[year]) return [];
  let data: any = gradesMap[year];
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return []; }
  }
  if (!data) return [];

  let subjectsRaw: any[] = [];
  const qKey = `quarter${quarter}`;

  // SUSH structure check
  if (data.grades && Array.isArray(data.grades[qKey])) {
    subjectsRaw = data.grades[qKey];
  } else if (Array.isArray(data[qKey])) {
    subjectsRaw = data[qKey];
  } else if (Array.isArray(data.periods)) {
    // BilimClass structure check
    const period = data.periods.find((p: any) =>
      Array.isArray(p?.subjects) && p.subjects.length > 0 && (
        Number(p.quarter) === quarter ||
        (typeof p.quarterLabel === 'string' && p.quarterLabel.includes(String(quarter))) ||
        (typeof p.name === 'string' && p.name.includes(String(quarter)))
      )
    );
    if (period && Array.isArray(period.subjects)) {
      subjectsRaw = period.subjects;
    }
  } else if (Array.isArray(data)) {
    const period = data.find((p: any) =>
      Number(p.quarter) === quarter ||
      (typeof p.Name === 'string' && p.Name.includes(String(quarter))) ||
      (typeof p.name === 'string' && p.name.includes(String(quarter)))
    );
    if (period && Array.isArray(period.subjects)) {
      subjectsRaw = period.subjects;
    } else {
      subjectsRaw = data;
    }
  } else if (data.subjects && Array.isArray(data.subjects)) {
    subjectsRaw = data.subjects;
  }

  const subjects = subjectsRaw.map(s => normalizeSubject(s, source));
  const report = data.grades?.report ?? data.report;
  if (source !== 'sush' || !Array.isArray(report)) return subjects;

  for (const row of report) {
    const mark = String(row?.[`q${quarter}`] ?? '').trim();
    if (!/^[1-5]$/.test(mark) || typeof row?.subject !== 'string' || !row.subject.trim()) continue;
    const subject = subjects.find(item => item.name.trim().toLowerCase() === row.subject.trim().toLowerCase());
    if (subject) subject.quarterGrade ??= mark;
    else subjects.push(normalizeSubject({ subject: row.subject, mark }, source));
  }
  return subjects;
}

function hasGrades(subjects: NormalizedSubject[]) {
  return subjects.some(subject => subject.quarterGrade != null || subject.finalPercent !== null ||
    subject.sorPercent !== null || subject.sochPercent !== null || subject.formativeMarks.length > 0);
}

async function readResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Сервис пока недоступен. Попробуйте позже.');
  return payload;
}

function displayError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    switch (error.code) {
      case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': return 'Проверьте корпоративную почту и пароль EduID.';
      case 'auth/email-already-in-use': return 'Этот адрес уже зарегистрирован. Откройте вход.';
      case 'auth/weak-password': return 'Выберите более надёжный пароль.';
      case 'auth/too-many-requests': return 'Слишком много попыток. Попробуйте позже.';
      default: return 'Firebase не смог завершить вход. Попробуйте позже.';
    }
  }
  return error instanceof Error ? error.message : 'Не удалось завершить запрос.';
}

export function Access() {
  const [mode, setMode] = useState<Mode>('login');
  const [audience, setAudience] = useState<Audience>('student');
  const [source, setSource] = useState<SchoolSource>('bilimclass');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [progress, setProgress] = useState<ImportStatus | null>(null);
  const [application, setApplication] = useState<OrganizationStatus | null>(null);
  const [loadedApplication, setLoadedApplication] = useState(false);
  const [editingApplication, setEditingApplication] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Student Dashboard state
  const [activeTab, setActiveTab] = useState<'home' | 'grades' | 'achievements' | 'leaderboard' | 'notifications' | 'profile'>('home');
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [grades, setGrades] = useState<Record<string, unknown>>({});
  const [achievements, setAchievements] = useState<Record<string, Achievement>>({});
  const [notifications, setNotifications] = useState<Record<string, NotificationItem>>({});
  const [preferredYear, setPreferredYear] = useState('');
  const [preferredQuarter, setPreferredQuarter] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Organization & Admin Dashboard state
  const isAdmin = session?.user?.email?.toLowerCase() === 'tasmuhambetovtair@gmail.com';
  const [orgTab, setOrgTab] = useState<'leaderboard' | 'subscription'>('leaderboard');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('Все регионы');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; student: LeaderboardItem } | null>(null);

  const [adminTab, setAdminTab] = useState<'achievements' | 'organizations' | 'leaderboard'>('achievements');
  const [adminAchievements, setAdminAchievements] = useState<any[]>([]);
  const [adminOrgs, setAdminOrgs] = useState<any[]>([]);
  const [adminScoreInputs, setAdminScoreInputs] = useState<Record<string, number>>({});
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  // Add Achievement Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formTypeCategory, setFormTypeCategory] = useState<'Олимпиада' | 'Хакатон' | 'Спортивное соревнование' | 'Другое'>('Олимпиада');
  const [formCustomType, setFormCustomType] = useState('');
  const [formStage, setFormStage] = useState('Школьный');
  const [formPlace, setFormPlace] = useState('1 место');
  const [formPhoto, setFormPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [uploadError, setUploadError] = useState<string>('');
  const [savingAchievement, setSavingAchievement] = useState(false);

  // Lightbox viewer for certificates
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, user => {
    setApplication(null);
    setLoadedApplication(false);
    if (!user) { setSession(null); setProfile(null); setProgress(null); setGrades({}); setAchievements({}); setNotifications({}); return; }
    void user.getIdTokenResult().then(result => {
      if (auth.currentUser?.uid !== user.uid) return;
      setVerified(user.emailVerified);
      setSession({ user, kind: result.claims.accountType === 'student' ? 'student' : 'organization' });
    }).catch(() => setError('Не удалось проверить сессию EduID.'));
  }), []);

  useEffect(() => {
    if (!session || !database) return;
    const { user, kind } = session;
    const unreadable = () => setError('Не удалось подключиться к данным EduID.');
    if (kind === 'student') {
      const stopProfile = onValue(ref(database, `students/${user.uid}/profile`), snap => setProfile(snap.val()), unreadable);
      const stopProgress = onValue(ref(database, `students/${user.uid}/import`), snap => setProgress(snap.val()), unreadable);
      const stopGrades = onValue(ref(database, `students/${user.uid}/grades`), snap => {
        const val = snap.val() || {};
        setGrades(val);
      }, unreadable);
      const stopAchievements = onValue(ref(database, `students/${user.uid}/achievements`), snap => {
        const val = snap.val() || {};
        const parsed: Record<string, Achievement> = {};
        for (const [key, item] of Object.entries(val)) {
          if (item && typeof item === 'object') {
            parsed[key] = { ...(item as any), id: key };
          }
        }
        setAchievements(parsed);
      }, unreadable);
      const stopNotifications = onValue(ref(database, `students/${user.uid}/notifications`), snap => {
        const val = snap.val() || {};
        const parsed: Record<string, NotificationItem> = {};
        for (const [key, item] of Object.entries(val)) {
          if (item && typeof item === 'object') {
            parsed[key] = { ...(item as any), id: key };
          }
        }
        setNotifications(parsed);
      }, unreadable);
      return () => { stopProfile(); stopProgress(); stopGrades(); stopAchievements(); stopNotifications(); };
    }
    return onValue(ref(database, `organizationStatus/${user.uid}`), snap => {
      setApplication(snap.val()); setLoadedApplication(true);
    }, () => { setLoadedApplication(true); unreadable(); });
  }, [session]);

  // Available academic years
  const availableYears = useMemo(() => {
    const keys = Object.keys(grades);
    return keys.sort((a, b) => Number(b) - Number(a));
  }, [grades]);

  const subjectsByYear = useMemo(() => new Map(availableYears.map(year => [year,
    [1, 2, 3, 4].map(quarter => parseGradesForPeriod(grades, year, quarter, profile?.source || 'bilimclass')),
  ])), [availableYears, grades, profile?.source]);
  const selectedYear = availableYears.includes(preferredYear) ? preferredYear :
    availableYears.find(year => subjectsByYear.get(year)?.some(hasGrades)) ??
    availableYears.find(year => subjectsByYear.get(year)?.some(subjects => subjects.length > 0)) ?? availableYears[0] ?? '';
  const yearSubjects = subjectsByYear.get(selectedYear);
  const latestGradedQuarter = yearSubjects?.findLastIndex(hasGrades) ?? -1;
  const latestQuarterWithSubjects = yearSubjects?.findLastIndex(subjects => subjects.length > 0) ?? -1;
  const selectedQuarter = preferredQuarter ?? (latestGradedQuarter >= 0 ? latestGradedQuarter + 1 : Math.max(1, latestQuarterWithSubjects + 1));
  const currentSubjects = yearSubjects?.[selectedQuarter - 1] ?? [];

  // Best subject for selected quarter
  const subjectsWithGrades = useMemo(() => currentSubjects.filter(s => s.finalPercent !== null && s.finalPercent > 0), [currentSubjects]);

  const bestSubject = useMemo(() => {
    if (!subjectsWithGrades.length) return null;
    return subjectsWithGrades.reduce((best, curr) => ((curr.finalPercent ?? 0) > (best.finalPercent ?? 0) ? curr : best));
  }, [subjectsWithGrades]);

  // Overall average percentage across ALL available years and ALL quarters
  const allAvailableFinalPercentages = useMemo(() => {
    const all: number[] = [];
    for (const yearSubjects of subjectsByYear.values()) {
      for (const subs of yearSubjects) {
        for (const s of subs) {
          if (typeof s.finalPercent === 'number' && !isNaN(s.finalPercent) && s.finalPercent > 0) {
            all.push(s.finalPercent);
          }
        }
      }
    }
    return all;
  }, [subjectsByYear]);

  const overallAveragePercent = useMemo(() => {
    if (!allAvailableFinalPercentages.length) return null;
    const total = allAvailableFinalPercentages.reduce((acc, p) => acc + p, 0);
    return Math.round(total / allAvailableFinalPercentages.length);
  }, [allAvailableFinalPercentages]);

  // Sorted achievements
  const sortedAchievements = useMemo(() => {
    return Object.values(achievements).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [achievements]);

  // Real-time notifications from database
  const sortedNotifications = useMemo(() => {
    return Object.values(notifications).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  }, [notifications]);

  const unreadCount = useMemo(() => {
    return sortedNotifications.filter(n => !n.read).length;
  }, [sortedNotifications]);

  async function handleMarkAsRead(notifId: string) {
    if (!session?.user || !database) return;
    try {
      await update(ref(database, `students/${session.user.uid}/notifications/${notifId}`), {
        read: true,
      });
    } catch {
      // ignore
    }
  }

  async function handleMarkAllNotificationsAsRead() {
    if (!session?.user || !database || unreadCount === 0) return;
    try {
      const updates: Record<string, boolean> = {};
      for (const notif of sortedNotifications) {
        if (!notif.read) {
          updates[`students/${session.user.uid}/notifications/${notif.id}/read`] = true;
        }
      }
      if (Object.keys(updates).length > 0) {
        await update(ref(database), updates);
      }
    } catch {
      // ignore
    }
  }

  // TalentScore calculation (points awarded for verified achievements)
  const userTalentScore = useMemo(() => {
    let score = 0;
    for (const ach of Object.values(achievements)) {
      if (ach.status === 'verified') {
        const base = ach.stage === 'Всемирный' ? 300 :
                     ach.stage === 'Республиканский' ? 200 :
                     ach.stage === 'Сетевой' ? 150 :
                     ach.stage === 'Областной' ? 100 :
                     ach.stage === 'Городской' ? 75 : 50;
        score += base;
      }
    }
    return score;
  }, [achievements]);

  // Animated counter for TalentScore
  const [counterScore, setCounterScore] = useState(0);
  useEffect(() => {
    let current = 0;
    const target = userTalentScore;
    if (target === 0) {
      setCounterScore(0);
      return;
    }
    const step = Math.max(1, Math.ceil(target / 25));
    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        setCounterScore(target);
        clearInterval(timer);
      } else {
        setCounterScore(current);
      }
    }, 25);
    return () => clearInterval(timer);
  }, [userTalentScore]);

  // Greeting name: "Добро пожаловать, {name}!"
  const displayName = useMemo(() => {
    if (!profile?.fullName) return 'Ученик';
    const parts = profile.fullName.trim().split(/\s+/);
    return parts.length > 1 ? parts[1] : parts[0];
  }, [profile?.fullName]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoadingLeaderboard(true);
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/student/leaderboard', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.leaderboard)) {
        setLeaderboard(data.leaderboard);
        if (typeof data.userRank === 'number') setUserRank(data.userRank);
      }
    } catch {
      // ignore
    } finally {
      setLoadingLeaderboard(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      void fetchLeaderboard();
    }
  }, [session, fetchLeaderboard]);

  // Load Admin Data (achievements & organizations)
  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setLoadingAdmin(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const [resAch, resOrgs] = await Promise.all([
        fetch('/api/admin/achievements', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/organizations', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const dataAch = await resAch.json();
      const dataOrgs = await resOrgs.json();
      if (dataAch.ok && Array.isArray(dataAch.achievements)) {
        setAdminAchievements(dataAch.achievements);
        const initialScores: Record<string, number> = {};
        for (const item of dataAch.achievements) {
          const st = item.achievement.stage;
          const defScore = st === 'Всемирный' || st === 'Международный' ? 80 :
                           st === 'Республиканский' ? 50 :
                           st === 'Сетевой' || st === 'Областной' ? 25 : 10;
          initialScores[item.achievement.id] = typeof item.achievement.score === 'number' ? item.achievement.score : defScore;
        }
        setAdminScoreInputs(initialScores);
      }
      if (dataOrgs.ok && Array.isArray(dataOrgs.organizations)) {
        setAdminOrgs(dataOrgs.organizations);
      }
    } catch {
      // ignore
    } finally {
      setLoadingAdmin(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin && session) {
      void loadAdminData();
    }
  }, [isAdmin, session, loadAdminData]);

  // Close context menu on outside click
  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  async function handleAdminApprove(studentUid: string, achievementId: string) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const score = adminScoreInputs[achievementId] ?? 20;
      const res = await fetch('/api/admin/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'approve', studentUid, achievementId, score }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminAchievements(prev => prev.map(item => item.achievement.id === achievementId ? {
          ...item,
          achievement: { ...item.achievement, status: 'verified', score },
        } : item));
        setNotice(`Достижение одобрено! Начислено ${score} баллов.`);
      } else {
        setError(data.error || 'Ошибка при одобрении.');
      }
    } catch {
      setError('Не удалось одобрить достижение.');
    }
  }

  async function handleAdminReject(studentUid: string, achievementId: string) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'reject', studentUid, achievementId }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminAchievements(prev => prev.map(item => item.achievement.id === achievementId ? {
          ...item,
          achievement: { ...item.achievement, status: 'rejected' },
        } : item));
        setNotice('Достижение отклонено.');
      } else {
        setError(data.error || 'Ошибка при отклонении.');
      }
    } catch {
      setError('Не удалось отклонить достижение.');
    }
  }

  async function handleAdminToggleVerification(orgUid: string, currentVerified: boolean) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const next = !currentVerified;
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'set_verification', orgUid, verified: next }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminOrgs(prev => prev.map(o => o.uid === orgUid ? { ...o, verified: next, status: next ? 'verified' : 'unverified' } : o));
        setNotice(next ? 'Организация верифицирована!' : 'Верификация организации снята.');
      } else {
        setError(data.error || 'Ошибка обновления статуса.');
      }
    } catch {
      setError('Не удалось изменить статус организации.');
    }
  }

  async function handleAdminToggleSubscription(orgUid: string, currentHasSub: boolean) {
    try {
      const token = await auth.currentUser?.getIdToken();
      const next = !currentHasSub;
      const res = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'set_subscription', orgUid, hasSubscription: next }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminOrgs(prev => prev.map(o => o.uid === orgUid ? { ...o, hasSubscription: next } : o));
        setNotice(next ? 'Подписка активирована!' : 'Подписка отключена.');
      } else {
        setError(data.error || 'Ошибка обновления подписки.');
      }
    } catch {
      setError('Не удалось изменить статус подписки.');
    }
  }

  async function handleRequestContacts(studentUid: string, studentName: string) {
    setContextMenu(null);
    if (!application?.hasSubscription) {
      setError('Для запроса контактов учеников требуется активная подписка (50 000 ₸). Перейдите во вкладку «Подписка».');
      setOrgTab('subscription');
      return;
    }
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/organization/contact-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ studentUid }),
      });
      const data = await res.json();
      if (data.ok) {
        setNotice(`Запрос контактов отправлен ученику ${studentName}! Ученик получит уведомление с подтверждением через родителя.`);
      } else {
        setError(data.error || 'Не удалось отправить запрос контактов.');
      }
    } catch {
      setError('Не удалось связаться с сервером.');
    }
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setUploadError('');
    if (!file) {
      setFormPhoto(null);
      setPhotoPreview('');
      return;
    }
    // Limit: max 2MB per photo
    if (file.size > 2 * 1024 * 1024) {
      setUploadError(`Размер фото не должен превышать 2 МБ (выбран файл: ${(file.size / 1024 / 1024).toFixed(1)} МБ).`);
      e.target.value = '';
      return;
    }
    setFormPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleAddAchievement(e: FormEvent) {
    e.preventDefault();
    if (!session?.user || savingAchievement) return;
    if (!formPhoto) {
      setUploadError('Обязательно прикрепите фото сертификата.');
      return;
    }

    setSavingAchievement(true);
    setError('');
    setUploadError('');

    try {
      const token = await session.user.getIdToken();

      // 1. Загрузка фото в Cloudflare R2 через API с проверкой лимитов
      const fd = new FormData();
      fd.append('photo', formPhoto);
      const uploadRes = await fetch('/api/student/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const { photoUrl, photoSize } = await readResponse(uploadRes);

      // 2. Сохранение достижения
      const resolvedType = formTypeCategory === 'Другое' ? formCustomType.trim() || 'Достижение' : formTypeCategory;
      const data = {
        title: formTitle.trim(),
        date: formDate,
        type: resolvedType,
        stage: formStage,
        place: formPlace.trim(),
        photoUrl,
        photoSize,
        status: 'unverified' as const,
      };

      const res = await fetch('/api/student/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      await readResponse(res);

      setIsModalOpen(false);
      setFormTitle('');
      setFormPhoto(null);
      setPhotoPreview('');
      setFormCustomType('');
    } catch (err) {
      setError(displayError(err));
    } finally {
      setSavingAchievement(false);
    }
  }

  async function handleDeleteAchievement(id: string) {
    if (!session?.user) return;
    try {
      const token = await session.user.getIdToken();
      await fetch(`/api/student/achievements?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      setError(displayError(err));
    }
  }

  function changeMode(value: Mode) { setMode(value); setError(''); setNotice(''); }
  function switchAudience() {
    setAudience(audience === 'student' ? 'organization' : 'student');
    changeMode(audience === 'student' ? 'register' : 'login');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get('password') ?? '');
    setError(''); setNotice(''); setBusy(true);
    try {
      if (audience === 'student') {
        const response = await fetch('/api/student', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: mode, source, login: fields.get('login'), password, region: fields.get('region') || undefined, consent: fields.has('consent') }) });
        const { token, profile: loadedProfile } = await readResponse(response);
        await signInWithCustomToken(auth, token);
        setProfile(loadedProfile);
      } else {
        const email = String(fields.get('email') ?? '').trim().toLowerCase();
        if (mode === 'login') {
          await signInWithEmailAndPassword(auth, email, password);
        } else {
          const file = fields.get('proof');
          if (!(file instanceof File) || !file.size || file.size > maxDocumentBytes) {
            throw new Error('Приложите документ подтверждения полномочий (PDF, PNG или JPG до 3 МБ).');
          }
          let user = session?.kind === 'organization' ? session.user : null;
          if (!user) {
            try {
              user = (await createUserWithEmailAndPassword(auth, email, password)).user;
            } catch (error: any) {
              if (error?.code === 'auth/email-already-in-use') {
                user = (await signInWithEmailAndPassword(auth, email, password)).user;
              } else {
                throw error;
              }
            }
          }
          fields.delete('password');
          const token = await user.getIdToken(true);
          const response = await fetch('/api/organization', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fields,
          });
          await readResponse(response);
          setApplication({
            name: String(fields.get('name')),
            status: 'unverified',
            verified: false,
            hasSubscription: false,
            submittedAt: Date.now(),
          });
        }
      }
      form.reset();
    } catch (error) { setError(displayError(error)); }
    finally { setBusy(false); }
  }

  async function exit() {
    setNotice(''); setError(''); setEditingApplication(false);
    if (profile) setSource(profile.source);
    setAudience(session?.kind ?? 'student'); setMode('login');
    await signOut(auth);
  }

  async function checkEmail(send: boolean) {
    if (!session || busy) return;
    setBusy(true); setNotice(''); setError('');
    try {
      if (send) { await sendEmailVerification(session.user); setNotice('Письмо для подтверждения отправлено.'); }
      else {
        await reload(session.user);
        setVerified(session.user.emailVerified);
        if (!session.user.emailVerified) setNotice('Почта ещё не подтверждена. Откройте ссылку из письма.');
      }
    } catch (error) { setError(displayError(error)); }
    finally { setBusy(false); }
  }

  // Student View with Sidebar and Tabs
  if (session?.kind === 'student') {
    return (
      <div className="private-page">
        {error && <p className="message private-message" role="alert">{error}</p>}
        {progress && <Progress status={progress} retry={() => void exit()} />}

        <div className="student-dashboard">
          {/* Закрепленная строгая боковая панель */}
          <aside className="dashboard-sidebar" aria-label="Разделы ученика">
            <div className="sidebar-brand">
              <Logo />
              <span className="brand-role-tag">STUDENT</span>
            </div>

            <nav className="sidebar-nav">
              <button
                type="button"
                className="sidebar-tab-btn"
                aria-selected={activeTab === 'home'}
                onClick={() => { setActiveTab('home'); setIsAccountMenuOpen(false); }}
              >
                <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                <span>Главная</span>
              </button>
              <button
                type="button"
                className="sidebar-tab-btn"
                aria-selected={activeTab === 'grades'}
                onClick={() => { setActiveTab('grades'); setIsAccountMenuOpen(false); }}
              >
                <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                <span>Мои оценки</span>
              </button>
              <button
                type="button"
                className="sidebar-tab-btn"
                aria-selected={activeTab === 'achievements'}
                onClick={() => { setActiveTab('achievements'); setIsAccountMenuOpen(false); }}
              >
                <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                <span>Мои достижения</span>
              </button>
              <button
                type="button"
                className="sidebar-tab-btn"
                aria-selected={activeTab === 'leaderboard'}
                onClick={() => { setActiveTab('leaderboard'); setIsAccountMenuOpen(false); }}
              >
                <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span>Лидерборд</span>
              </button>
            </nav>

            {/* Нижняя часть боковой панели */}
            <div className="sidebar-bottom">
              {/* Вкладка Уведомления */}
              <button
                type="button"
                className="sidebar-tab-btn notifications-tab-btn"
                aria-selected={activeTab === 'notifications'}
                onClick={() => { setActiveTab('notifications'); setIsAccountMenuOpen(false); }}
              >
                <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <span>Уведомления</span>
                {unreadCount > 0 && <span className="tab-badge-count">{unreadCount}</span>}
              </button>

              {/* Карточка аккаунта снизу слева */}
              <div className="sidebar-account-container">
                <button
                  type="button"
                  className="sidebar-account-card"
                  onClick={() => setIsAccountMenuOpen(prev => !prev)}
                  aria-expanded={isAccountMenuOpen}
                >
                  <span className="account-avatar">{displayName.charAt(0)}</span>
                  <div className="account-info">
                    <span className="account-name">{profile?.fullName || 'Ученик'}</span>
                    <span className="account-sub">{profile?.classLabel || 'Класс'} • {providers[profile?.source || 'bilimclass']}</span>
                  </div>
                  <svg className={`account-chevron ${isAccountMenuOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>

                {/* Выпадающее меню при нажатии */}
                {isAccountMenuOpen && (
                  <div className="account-dropdown-menu">
                    <button
                      type="button"
                      className="account-menu-item"
                      onClick={() => { setActiveTab('profile'); setIsAccountMenuOpen(false); }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      <span>Профиль</span>
                    </button>
                    <button
                      type="button"
                      className="account-menu-item logout"
                      onClick={() => { setIsAccountMenuOpen(false); void exit(); }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      <span>Выйти</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Содержимое вкладки */}
          <main className="dashboard-content">
            {/* Вкладка 1: Главная */}
            {activeTab === 'home' && (
              <section aria-labelledby="home-heading" className="home-dashboard-section">
                <div className="home-welcome-header">
                  <h2 id="home-heading" className="home-welcome-title">
                    Добро пожаловать, <span className="highlight-name">{displayName}</span>
                  </h2>
                  <p className="home-welcome-subtitle">
                    Академическая аналитика, рейтинг TalentScore и история успеваемости.
                  </p>
                </div>

                {/* Карточки метрик на одной линии на всю ширину */}
                <div className="home-metrics-row">
                  {/* Карточка 1: TalentScore */}
                  <div className="home-metric-card talent-score-card">
                    <div className="metric-card-top">
                      <span className="metric-badge talent">TalentScore</span>
                      <span className="metric-tag">Академический рейтинг</span>
                    </div>
                    <div className="metric-counter-wrap">
                      <span className="metric-counter-value">{counterScore}</span>
                      <span className="metric-counter-unit">баллов</span>
                    </div>
                    <div className="metric-card-footer">
                      <p>
                        Начисляются за верифицированные олимпиады, хакатоны и дипломы.
                      </p>
                      <button
                        type="button"
                        className="text-link-btn"
                        onClick={() => setActiveTab('achievements')}
                      >
                        + Добавить достижение →
                      </button>
                    </div>
                  </div>

                  {/* Карточка 2: Средний процент за всё время */}
                  <div className="home-metric-card average-grade-card">
                    <div className="metric-card-top">
                      <span className="metric-badge grades">Средний процент</span>
                      <span className="metric-tag">За всё время</span>
                    </div>
                    <div className="metric-gauge-wrap">
                      <CircularGauge percent={overallAveragePercent} />
                      <div className="metric-grade-details">
                        <div className="metric-grade-value">
                          {overallAveragePercent !== null ? `${overallAveragePercent}%` : '—'}
                        </div>
                        <span className="metric-grade-label">Общая успеваемость</span>
                      </div>
                    </div>
                    <div className="metric-card-footer">
                      <p>
                        Рассчитан по всем доступным учебным годам и четвертям.
                      </p>
                      <button
                        type="button"
                        className="text-link-btn"
                        onClick={() => setActiveTab('grades')}
                      >
                        Смотреть оценки →
                      </button>
                    </div>
                  </div>
                </div>

                {/* Превью Лидерборда по TalentScore снизу */}
                <div className="home-leaderboard-preview-card">
                  <div className="preview-header">
                    <div>
                      <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, letterSpacing: '-0.3px' }}>Лидерборд по TalentScore</h3>
                      <p className="preview-subtitle">Рейтинг пользователей платформы по подтверждённым достижениям</p>
                    </div>
                    <button
                      type="button"
                      className="view-leaderboard-btn"
                      onClick={() => setActiveTab('leaderboard')}
                    >
                      Открыть полный список →
                    </button>
                  </div>

                  {leaderboard.length > 0 ? (
                    <div className="preview-list">
                      {leaderboard.slice(0, 5).map((user, idx) => {
                        const rank = idx + 1;
                        const isCurrentUser = user.isCurrentUser || user.name === profile?.fullName;

                        return (
                          <div
                            key={user.uid}
                            className={`preview-item ${isCurrentUser ? 'current-user-item' : ''}`}
                            onClick={() => setActiveTab('leaderboard')}
                            role="button"
                            tabIndex={0}
                            title="Открыть подробный лидерборд"
                          >
                            <div className="preview-rank">
                              <span className={`rank-badge rank-${rank}`}>#{rank}</span>
                            </div>
                            <div className="preview-user-info">
                              <div className="preview-user-name">
                                <strong>{user.name}</strong>
                                {isCurrentUser && <span className="you-pill">Вы</span>}
                              </div>
                              <small className="preview-user-class">{user.classLabel}</small>
                            </div>
                            {/* Шкала среднего процента */}
                            <div className="preview-percent-wrap">
                              <div className="preview-percent-bar-track">
                                <div
                                  className="preview-percent-bar-fill"
                                  style={{ width: `${Math.min(100, Math.max(0, user.averagePercent ?? 0))}%` }}
                                />
                              </div>
                              <span className="preview-percent-value">
                                {user.averagePercent !== null ? `${user.averagePercent}%` : '—'}
                              </span>
                            </div>
                            <div className="preview-score">
                              <span className="score-pill">{user.talentScore} pts</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: '13px' }}>
                      В рейтинге пока нет зарегистрированных участников.
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* Вкладка: Профиль (выглядит как главная, но без приветствия и без таблицы лидерборда) */}
            {activeTab === 'profile' && (
              <section aria-labelledby="profile-heading" className="home-dashboard-section">
                <div className="profile-identity-card">
                  <div className="profile-avatar-large">{displayName.charAt(0)}</div>
                  <div className="profile-info-content">
                    <h2 id="profile-heading" className="profile-name">{profile?.fullName || 'Ученик'}</h2>
                    <div className="profile-meta-tags">
                      <span className="profile-tag">{profile?.classLabel || 'Класс'}</span>
                      <span className="profile-tag source">{providers[profile?.source || 'bilimclass']}</span>
                      <span className="profile-tag verified">Подтверждён</span>
                    </div>
                  </div>
                </div>

                {/* Карточки метрик на одной линии на всю ширину */}
                <div className="home-metrics-row">
                  {/* Карточка 1: TalentScore */}
                  <div className="home-metric-card talent-score-card">
                    <div className="metric-card-top">
                      <span className="metric-badge talent">TalentScore</span>
                      <span className="metric-tag">Академический рейтинг</span>
                    </div>
                    <div className="metric-counter-wrap">
                      <span className="metric-counter-value">{userTalentScore}</span>
                      <span className="metric-counter-unit">баллов</span>
                    </div>
                    <div className="metric-card-footer">
                      <p>
                        Начисляются за верифицированные олимпиады, хакатоны и дипломы.
                      </p>
                      <button
                        type="button"
                        className="text-link-btn"
                        onClick={() => setActiveTab('achievements')}
                      >
                        + Добавить достижение →
                      </button>
                    </div>
                  </div>

                  {/* Карточка 2: Средний процент за всё время */}
                  <div className="home-metric-card average-grade-card">
                    <div className="metric-card-top">
                      <span className="metric-badge grades">Средний процент</span>
                      <span className="metric-tag">За всё время</span>
                    </div>
                    <div className="metric-gauge-wrap">
                      <CircularGauge percent={overallAveragePercent} />
                      <div className="metric-grade-details">
                        <div className="metric-grade-value">
                          {overallAveragePercent !== null ? `${overallAveragePercent}%` : '—'}
                        </div>
                        <span className="metric-grade-label">Общая успеваемость</span>
                      </div>
                    </div>
                    <div className="metric-card-footer">
                      <p>
                        Рассчитан по всем доступным учебным годам и четвертям.
                      </p>
                      <button
                        type="button"
                        className="text-link-btn"
                        onClick={() => setActiveTab('grades')}
                      >
                        Смотреть оценки →
                      </button>
                    </div>
                  </div>
                </div>

                {/* Академическая статистика */}
                <div className="profile-stats-grid">
                  <div className="profile-stat-box">
                    <span className="stat-box-label">Всего достижений</span>
                    <strong className="stat-box-val">{Object.keys(achievements).length}</strong>
                    <small className="stat-box-sub">Загружено в портфолио</small>
                  </div>
                  <div className="profile-stat-box">
                    <span className="stat-box-label">Учебных годов</span>
                    <strong className="stat-box-val">{availableYears.length}</strong>
                    <small className="stat-box-sub">Синхронизировано в EduID</small>
                  </div>
                  <div className="profile-stat-box">
                    <span className="stat-box-label">Место в рейтинге</span>
                    <strong className="stat-box-val">#{userRank ?? '—'}</strong>
                    <small className="stat-box-sub">По шкале TalentScore</small>
                  </div>
                </div>
              </section>
            )}

            {/* Вкладка: Уведомления */}
            {activeTab === 'notifications' && (
              <section aria-labelledby="notifications-heading" className="notifications-section">
                <div className="dashboard-title-row">
                  <div>
                    <h2 id="notifications-heading">Уведомления</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '4px 0 0' }}>
                      Системные оповещения, статус синхронизации и проверка достижений.
                    </p>
                  </div>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      className="text-link-btn"
                      onClick={handleMarkAllNotificationsAsRead}
                      style={{ fontSize: '13px' }}
                    >
                      Отметить все как прочитанные
                    </button>
                  )}
                </div>

                {sortedNotifications.length === 0 ? (
                  <div className="empty-state-card" style={{ textAlign: 'center', padding: '48px 24px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <div style={{ color: '#94a3b8', marginBottom: '12px' }}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </div>
                    <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: '#0f172a' }}>Нет новых уведомлений</h3>
                    <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                      Здесь будут появляться реальные оповещения о проверке олимпиад и синхронизации оценок.
                    </p>
                  </div>
                ) : (
                  <div className="notifications-list">
                    {sortedNotifications.map(notif => {
                      const formattedDate = notif.createdAt
                        ? new Intl.DateTimeFormat('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(notif.createdAt))
                        : 'Только что';

                      return (
                        <div
                          key={notif.id}
                          className={`notification-card ${notif.read ? 'is-read' : 'is-unread'}`}
                          onClick={() => { if (!notif.read) handleMarkAsRead(notif.id); }}
                          style={{ cursor: notif.read ? 'default' : 'pointer' }}
                        >
                          <div className={`notification-indicator ${notif.type || 'info'}`} />
                          <div className="notification-body">
                            <div className="notification-header-row">
                              <div className="notification-title-wrap">
                                <strong>{notif.title}</strong>
                                {!notif.read && <span className="notification-unread-dot" title="Новое" />}
                              </div>
                              <span className="notification-date">{formattedDate}</span>
                            </div>
                            <p>{notif.message}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Вкладка 2: Мои оценки */}
            {activeTab === 'grades' && (
              <section aria-labelledby="grades-heading">
                {/* Верхняя строка с фильтрами */}
                <div className="dashboard-title-row">
                  <h2 id="grades-heading">Мои оценки</h2>
                  <div className="filter-group">
                    {/* Выбор учебного года / класса */}
                    <select
                      className="filter-select"
                      aria-label="Выбор учебного года"
                      value={selectedYear}
                      onChange={e => { setPreferredYear(e.target.value); setPreferredQuarter(null); }}
                    >
                      {availableYears.length > 0 ? (
                        availableYears.map(yr => (
                          <option key={yr} value={yr}>
                            {yr}–{Number(yr) + 1} учебный год {profile ? `(${profile.classNumber} класс)` : ''}
                          </option>
                        ))
                      ) : (
                        <option value="">Нет данных по годам</option>
                      )}
                    </select>

                    {/* Выбор четверти */}
                    <select
                      className="filter-select"
                      aria-label="Выбор четверти"
                      value={selectedQuarter}
                      onChange={e => setPreferredQuarter(Number(e.target.value))}
                    >
                      <option value={1}>1-я четверть</option>
                      <option value={2}>2-я четверть</option>
                      <option value={3}>3-я четверть</option>
                      <option value={4}>4-я четверть</option>
                    </select>
                  </div>
                </div>

                {/* Сводка: Средний процент с круговой шкалой и Лучший предмет */}
                <div className="summary-grid">
                  <div className="summary-card">
                    <CircularGauge percent={overallAveragePercent} />
                    <div className="summary-info">
                      <h3>Средний процент</h3>
                      <p>
                        {overallAveragePercent !== null
                          ? `Общая успеваемость за все четверти и года`
                          : 'Оценки за этот период ещё формируются'}
                      </p>
                    </div>
                  </div>

                  <div className="summary-card">
                    <div className="summary-info" style={{ width: '100%' }}>
                      <div className="best-badge">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                        Лучший результат
                      </div>
                      {bestSubject ? (
                        <>
                          <div className="best-subject-name">{bestSubject.name}</div>
                          <div className="best-subject-stat">
                            Итоговый процент: <strong>{bestSubject.finalPercent}%</strong>
                            {bestSubject.quarterGrade ? ` (оценка ${bestSubject.quarterGrade})` : ''}
                          </div>
                        </>
                      ) : (
                        <p style={{ margin: '8px 0 0' }}>Предметы ещё не оценены за эту четверть</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Таблица оценок */}
                <div className="table-card">
                  {currentSubjects.length > 0 ? (
                    <table className="grades-table">
                      <thead>
                        <tr>
                          <th>Предмет</th>
                          {profile?.source === 'bilimclass' && <th>ФО (баллы)</th>}
                          <th>СОР</th>
                          <th>СОЧ</th>
                          <th>Итоговый %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentSubjects.map((sub, idx) => {
                          const isBest = Boolean(bestSubject && sub.name === bestSubject.name && (sub.finalPercent ?? 0) > 0);
                          const pct = sub.finalPercent;

                          return (
                            <tr key={`${sub.name}-${idx}`} className={isBest ? 'row-best' : ''}>
                              <td>
                                <div className="subject-cell-title">
                                  <span>{sub.name}</span>
                                  {isBest && <span className="badge-top-tag">Топ</span>}
                                </div>
                              </td>
                              {profile?.source === 'bilimclass' && (
                                <td>
                                  {sub.formativeMarks.length > 0 ? (
                                    <div className="marks-chips-wrap">
                                      {sub.formativeMarks.map((m, mIdx) => (
                                        <span key={mIdx} className={`mark-chip ${getFormativeClass(m)}`}>
                                          {m}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span style={{ color: 'var(--muted)' }}>—</span>
                                  )}
                                </td>
                              )}
                              <td>
                                {sub.sorPercent !== null ? (
                                  <span className={`percent-pill ${getScoreClass(sub.sorPercent)}`}>
                                    {sub.sorPercent}%
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--muted)' }}>—</span>
                                )}
                              </td>
                              <td>
                                {sub.sochPercent !== null ? (
                                  <span className={`percent-pill ${getScoreClass(sub.sochPercent)}`}>
                                    {sub.sochPercent}%
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--muted)' }}>—</span>
                                )}
                              </td>
                              <td>
                                {pct !== null ? (
                                  <span className={`percent-pill ${getScoreClass(pct)}`}>
                                    {pct}% {sub.quarterGrade ? `(${sub.quarterGrade})` : ''}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--muted)' }}>{sub.quarterGrade ?? '—'}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty-state">
                      <p>За выбранный учебный год ({selectedYear}) и четверть ({selectedQuarter}) данные оценок пока отсутствуют.</p>
                      {progress?.status === 'running' && (
                        <p style={{ color: 'var(--blue)' }}>Идёт фоновый импорт данных из {providers[profile?.source || 'bilimclass']}…</p>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Вкладка 3: Мои достижения */}
            {activeTab === 'achievements' && (
              <section aria-labelledby="achievements-heading">
                <div className="dashboard-title-row">
                  <h2 id="achievements-heading">Мои достижения</h2>
                  <button
                    type="button"
                    className="primary"
                    style={{ minHeight: '40px', padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                    onClick={() => setIsModalOpen(true)}
                  >
                    <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span>
                    <span>Добавить достижение</span>
                  </button>
                </div>

                {sortedAchievements.length > 0 ? (
                  <div className="achievements-grid">
                    {sortedAchievements.map(ach => {
                      const isFirstPlace = ach.place?.includes('1') || ach.place?.toLowerCase().includes('гран');
                      const isSecondPlace = ach.place?.includes('2');
                      const isThirdPlace = ach.place?.includes('3');
                      let placeClass = 'meta-pill place';
                      if (isFirstPlace) placeClass += ' gold';
                      else if (isSecondPlace) placeClass += ' silver';
                      else if (isThirdPlace) placeClass += ' bronze';

                      return (
                        <div key={ach.id} className="achievement-card">
                          <div>
                            <div className="achievement-header">
                              <div style={{ minWidth: 0 }}>
                                <h3 className="achievement-type" style={{ wordBreak: 'break-word' }}>
                                  {ach.title || ach.type}
                                </h3>
                                <div className="achievement-meta">
                                  {ach.title && <span className="meta-pill" style={{ background: '#f1f5f9' }}>{ach.type}</span>}
                                  <span className="meta-pill stage">{ach.stage} этап</span>
                                  <span className={placeClass}>{ach.place}</span>
                                </div>
                              </div>
                              <span className={`status-badge ${ach.status || 'unverified'}`}>
                                {ach.status || 'unverified'}
                              </span>
                            </div>

                            {/* Фото сертификата */}
                            {ach.photoUrl && (
                              <div
                                className="achievement-photo-wrap"
                                onClick={() => setViewingPhotoUrl(ach.photoUrl)}
                                title="Нажмите, чтобы увеличить фото"
                              >
                                <img src={ach.photoUrl} alt="Сертификат" className="achievement-photo" />
                                <span className="photo-zoom-hint">Сертификат</span>
                              </div>
                            )}
                          </div>

                          <div className="achievement-footer">
                            <span>{new Date(ach.date).toLocaleDateString('ru-RU')}</span>
                            <button
                              type="button"
                              className="delete-btn"
                              onClick={() => void handleDeleteAchievement(ach.id)}
                              aria-label="Удалить достижение"
                            >
                              Удалить
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="table-card empty-state">
                    <p style={{ fontWeight: 600 }}>Список достижений пуст.</p>
                    <small style={{ color: 'var(--muted)' }}>
                      Нажмите «Добавить достижение», чтобы прикрепить сертификаты олимпиад, хакатонов и соревнований.
                    </small>
                  </div>
                )}
              </section>
            )}

            {/* Вкладка 4: Лидерборд */}
            {activeTab === 'leaderboard' && (
              <section aria-labelledby="leaderboard-heading" className="leaderboard-section">
                <div className="dashboard-title-row">
                  <div>
                    <h2 id="leaderboard-heading">Лидерборд по TalentScore</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '4px 0 0' }}>
                      Рейтинг среди пользователей сайта. Баллы начисляются за подтверждённые олимпиады и сертификаты.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="action-button secondary"
                    onClick={() => void fetchLeaderboard()}
                    disabled={loadingLeaderboard}
                  >
                    {loadingLeaderboard ? 'Обновление...' : 'Обновить'}
                  </button>
                </div>

                {/* Баннер с местом пользователя */}
                <div className="user-rank-banner">
                  <div className="user-rank-col">
                    <span className="user-rank-label">Ваше место в рейтинге</span>
                    <strong className="user-rank-number">#{userRank ?? '—'}</strong>
                  </div>
                  <div className="user-rank-col">
                    <span className="user-rank-label">Ваш TalentScore</span>
                    <strong className="user-rank-score">{userTalentScore} pts</strong>
                  </div>
                  <div className="user-rank-col">
                    <span className="user-rank-label">Средний процент</span>
                    <strong className="user-rank-score">{overallAveragePercent !== null ? `${overallAveragePercent}%` : '—'}</strong>
                  </div>
                  <div className="user-rank-col">
                    <span className="user-rank-label">Достижений в профиле</span>
                    <strong className="user-rank-score">{Object.keys(achievements).length}</strong>
                  </div>
                </div>

                {/* Таблица полного лидерборда */}
                <div className="table-card">
                  {leaderboard.length > 0 ? (
                    <table className="grades-table leaderboard-table">
                      <thead>
                        <tr>
                          <th style={{ width: '70px' }}>Место</th>
                          <th>Ученик</th>
                          <th>Школа / Класс</th>
                          <th style={{ width: '180px' }}>Средний процент</th>
                          <th style={{ textAlign: 'center', width: '110px' }}>Достижений</th>
                          <th style={{ textAlign: 'right', width: '140px' }}>TalentScore</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboard.map((item, idx) => {
                          const rank = idx + 1;
                          const isCurrent = item.isCurrentUser || item.name === profile?.fullName;

                          return (
                            <tr key={item.uid} className={isCurrent ? 'row-best current-user-row' : ''}>
                              <td>
                                <span className={`leaderboard-rank-tag rank-${rank}`}>
                                  #{rank}
                                </span>
                              </td>
                              <td>
                                <div className="leader-name-wrap">
                                  <span className="leader-avatar">{item.name.charAt(0)}</span>
                                  <div>
                                    <strong>{item.name}</strong>
                                    {isCurrent && <span className="you-pill">Вы</span>}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className="leader-class">{item.classLabel}</span>
                              </td>
                              {/* Шкала среднего процента в лидерборде */}
                              <td>
                                <div className="preview-percent-wrap">
                                  <div className="preview-percent-bar-track">
                                    <div
                                      className="preview-percent-bar-fill"
                                      style={{ width: `${Math.min(100, Math.max(0, item.averagePercent ?? 0))}%` }}
                                    />
                                  </div>
                                  <span className="preview-percent-value">
                                    {item.averagePercent !== null ? `${item.averagePercent}%` : '—'}
                                  </span>
                                </div>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className="achievements-count-tag">{item.achievementsCount}</span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span className="talent-score-pill">{item.talentScore} pts</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty-state">
                      <p>В лидерборде пока нет зарегистрированных учеников.</p>
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>
        </div>

        {/* Модальное окно добавления достижения */}
        {isModalOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-dialog">
              <div className="modal-header">
                <h3 id="modal-title">Новое достижение</h3>
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => setIsModalOpen(false)}
                  aria-label="Закрыть"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleAddAchievement} className="modal-form">
                <Field label="Название олимпиады / мероприятия">
                  <input
                    type="text"
                    required
                    placeholder="Например: Республиканская олимпиада по математике"
                    value={formTitle}
                    onChange={e => setFormTitle(e.target.value)}
                  />
                </Field>

                <Field label="Дата получения">
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                  />
                </Field>

                <Field label="Тип мероприятия">
                  <select
                    value={formTypeCategory}
                    onChange={e => setFormTypeCategory(e.target.value as any)}
                  >
                    <option value="Олимпиада">Олимпиада</option>
                    <option value="Хакатон">Хакатон</option>
                    <option value="Спортивное соревнование">Спортивное соревнование</option>
                    <option value="Другое">Другое (указать вручную)</option>
                  </select>
                </Field>

                {formTypeCategory === 'Другое' && (
                  <Field label="Название или тип мероприятия">
                    <input
                      type="text"
                      required
                      placeholder="Например: Научная конференция, Конкурс проектов"
                      value={formCustomType}
                      onChange={e => setFormCustomType(e.target.value)}
                    />
                  </Field>
                )}

                <Field label="Этап">
                  <select
                    value={formStage}
                    onChange={e => setFormStage(e.target.value)}
                  >
                    <option value="Школьный">Школьный</option>
                    <option value="Городской">Городской</option>
                    <option value="Областной">Областной</option>
                    <option value="Сетевой">Сетевой</option>
                    <option value="Республиканский">Республиканский</option>
                    <option value="Всемирный">Всемирный</option>
                  </select>
                </Field>

                <Field label="Занятое место или результат">
                  <input
                    type="text"
                    required
                    placeholder="Например: 1 место, Гран-при, Призёр"
                    value={formPlace}
                    onChange={e => setFormPlace(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {['1 место', '2 место', '3 место', 'Гран-при', 'Призёр'].map(quick => (
                      <button
                        type="button"
                        key={quick}
                        className="meta-pill"
                        style={{ cursor: 'pointer', background: formPlace === quick ? '#fef08a' : '#f1f5f9' }}
                        onClick={() => setFormPlace(quick)}
                      >
                        {quick}
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Загрузка фото сертификата */}
                <Field label="Фото сертификата" hint="Обязательно для подтверждения достижения">
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={handlePhotoChange}
                  />
                  {photoPreview && (
                    <div className="photo-preview-wrap">
                      <img src={photoPreview} alt="Предпросмотр" className="photo-preview-img" />
                      <div>
                        <strong>{formPhoto?.name}</strong>
                        <div>
                          <span className="photo-size-pill">
                            {formPhoto ? `${(formPhoto.size / 1024 / 1024).toFixed(2)} МБ` : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {uploadError && <p className="message" role="alert" style={{ marginTop: '8px' }}>{uploadError}</p>}
                </Field>

                <div className="modal-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setIsModalOpen(false)}
                    disabled={savingAchievement}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    style={{ minHeight: '40px', padding: '0 18px' }}
                    disabled={savingAchievement}
                  >
                    {savingAchievement ? 'Загрузка фото и сохранение…' : 'Сохранить'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Просмотр полного фото сертификата (Lightbox) */}
        {viewingPhotoUrl && (
          <div
            className="lightbox-overlay"
            onClick={() => setViewingPhotoUrl(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Просмотр сертификата"
          >
            <div className="lightbox-dialog" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="lightbox-close"
                onClick={() => setViewingPhotoUrl(null)}
                aria-label="Закрыть фото"
              >
                ×
              </button>
              <img src={viewingPhotoUrl} alt="Сертификат в полном размере" className="lightbox-img" />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (session?.kind === 'organization') {
    const orgFilteredLeaderboard = leaderboard.filter(item => {
      if (selectedRegionFilter === 'Все регионы') return true;
      return item.region === selectedRegionFilter;
    });

    return (
      <div className="private-page">
        {error && <p className="message private-message" role="alert">{error}</p>}
        {notice && <p className="message private-message info" role="status">{notice}</p>}

        <div className="student-dashboard">
          {/* Боковая панель для организации / админа */}
          <aside className="dashboard-sidebar" aria-label="Панель организации">
            <div className="sidebar-brand">
              <Logo />
              <span className="brand-role-tag">{isAdmin ? 'ADMIN' : 'ORGANIZATION'}</span>
            </div>

            <nav className="sidebar-nav">
              {isAdmin ? (
                <>
                  <button
                    type="button"
                    className="sidebar-tab-btn"
                    aria-selected={adminTab === 'achievements'}
                    onClick={() => { setAdminTab('achievements'); setIsAccountMenuOpen(false); }}
                  >
                    <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                    <span>Модерация олимпиад</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-tab-btn"
                    aria-selected={adminTab === 'organizations'}
                    onClick={() => { setAdminTab('organizations'); setIsAccountMenuOpen(false); }}
                  >
                    <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    <span>Организации</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-tab-btn"
                    aria-selected={adminTab === 'leaderboard'}
                    onClick={() => { setAdminTab('leaderboard'); setIsAccountMenuOpen(false); }}
                  >
                    <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span>Лидерборд</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="sidebar-tab-btn"
                    aria-selected={orgTab === 'leaderboard'}
                    onClick={() => { setOrgTab('leaderboard'); setIsAccountMenuOpen(false); }}
                  >
                    <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span>Лидерборд</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-tab-btn"
                    aria-selected={orgTab === 'subscription'}
                    onClick={() => { setOrgTab('subscription'); setIsAccountMenuOpen(false); }}
                  >
                    <svg className="tab-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
                    <span>Подписка</span>
                  </button>
                </>
              )}
            </nav>

            <div className="sidebar-bottom">
              <div className="sidebar-account-container">
                <button
                  type="button"
                  className="sidebar-account-card"
                  onClick={() => setIsAccountMenuOpen(prev => !prev)}
                  aria-expanded={isAccountMenuOpen}
                >
                  <span className="account-avatar">
                    {isAdmin ? 'T' : (application?.name?.charAt(0) || 'O')}
                  </span>
                  <div className="account-info">
                    <span className="account-name">
                      {isAdmin ? 'Tair Tasmukhambetov' : (application?.name || 'Организация')}
                    </span>
                    <span className="account-class">
                      {isAdmin ? (
                        <span className="badge-status-admin">Администратор</span>
                      ) : (
                        <span className={application?.status === 'verified' || application?.verified ? 'badge-status-verified' : 'badge-status-unverified'}>
                          {application?.status === 'verified' || application?.verified ? 'verified' : 'unverified'}
                        </span>
                      )}
                    </span>
                  </div>
                </button>

                {isAccountMenuOpen && (
                  <div className="account-dropdown-menu" role="menu">
                    <button
                      type="button"
                      className="account-menu-item logout"
                      role="menuitem"
                      onClick={() => void exit()}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                      <span>Выйти</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Основная часть контента организации / админа */}
          <main className="dashboard-content">
            {/* АДМИНИСТРАТОР: 1. Вкладка Модерация олимпиад */}
            {isAdmin && adminTab === 'achievements' && (
              <section aria-labelledby="admin-ach-heading">
                <div className="dashboard-title-row">
                  <div>
                    <h2 id="admin-ach-heading">Модерация олимпиад и достижений</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '4px 0 0' }}>
                      Проверка подтверждающих сертификатов и начисление баллов TalentScore.
                    </p>
                  </div>
                  <button type="button" className="text-button" onClick={() => void loadAdminData()}>
                    Обновить данные
                  </button>
                </div>

                <div className="admin-guide-card">
                  <div className="admin-guide-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    Рекомендации по начислению баллов TalentScore (0 – 100):
                  </div>
                  <div className="admin-guide-grid">
                    <div className="admin-guide-item"><strong>Школьный этап:</strong> 0 – 10 баллов (зависит от места)</div>
                    <div className="admin-guide-item"><strong>Областной / Сетевой:</strong> 10 – 40 баллов (зависит от типа и места)</div>
                    <div className="admin-guide-item"><strong>Республиканский:</strong> 40 – 70 баллов (зависит от места)</div>
                    <div className="admin-guide-item"><strong>Международный / Всемирный:</strong> 70 – 100+ баллов</div>
                  </div>
                </div>

                {loadingAdmin ? (
                  <p style={{ color: '#64748b' }}>Загрузка заявок…</p>
                ) : adminAchievements.length === 0 ? (
                  <div className="empty-state-card" style={{ textAlign: 'center', padding: '40px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <h3 style={{ margin: 0, color: '#0f172a' }}>Заявок на проверку пока нет</h3>
                    <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '13px' }}>Здесь будут появляться все дипломы и грамоты, загруженные учениками.</p>
                  </div>
                ) : (
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Ученик</th>
                        <th>Название мероприятия</th>
                        <th>Категория / Этап</th>
                        <th>Место</th>
                        <th>Сертификат</th>
                        <th>Статус</th>
                        <th style={{ width: '220px' }}>Оценка и действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminAchievements.map((item, idx) => {
                        const ach = item.achievement;
                        const isVerified = ach.status === 'verified';
                        const isRejected = ach.status === 'rejected';
                        const isUnverified = !isVerified && !isRejected;

                        return (
                          <tr key={`${ach.id}-${idx}`}>
                            <td>
                              <strong>{item.studentName}</strong>
                              <div style={{ fontSize: '11px', color: '#64748b' }}>{item.studentClass}</div>
                            </td>
                            <td>
                              <span style={{ fontWeight: 600 }}>{ach.title}</span>
                              <div style={{ fontSize: '11px', color: '#94a3b8' }}>{ach.date}</div>
                            </td>
                            <td>
                              <div>{ach.type}</div>
                              <small style={{ color: '#64748b' }}>{ach.stage}</small>
                            </td>
                            <td>
                              <span style={{ fontWeight: 600 }}>{ach.place}</span>
                            </td>
                            <td>
                              {ach.photoUrl ? (
                                <button
                                  type="button"
                                  className="cert-thumbnail-btn"
                                  onClick={() => setViewingPhotoUrl(ach.photoUrl)}
                                  title="Нажмите для просмотра фото"
                                >
                                  <img src={ach.photoUrl} alt="Сертификат" className="cert-thumbnail" />
                                </button>
                              ) : (
                                <span style={{ color: '#94a3b8', fontSize: '12px' }}>Нет файла</span>
                              )}
                            </td>
                            <td>
                              {isVerified ? (
                                <span className="badge-status-verified">verified</span>
                              ) : isRejected ? (
                                <span className="badge-status-unverified" style={{ color: '#ef4444', borderColor: '#fca5a5' }}>rejected</span>
                              ) : (
                                <span className="badge-status-unverified">unverified</span>
                              )}
                            </td>
                            <td>
                              {isUnverified ? (
                                <div className="admin-actions-cell">
                                  <input
                                    type="number"
                                    min="0"
                                    max="500"
                                    className="score-input"
                                    value={adminScoreInputs[ach.id] ?? 20}
                                    onChange={e => {
                                      const val = parseInt(e.target.value) || 0;
                                      setAdminScoreInputs(prev => ({ ...prev, [ach.id]: val }));
                                    }}
                                    title="Количество баллов TalentScore (0-100+)"
                                  />
                                  <button
                                    type="button"
                                    className="btn-approve"
                                    onClick={() => handleAdminApprove(item.studentUid, ach.id)}
                                  >
                                    Одобрить
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-reject"
                                    onClick={() => handleAdminReject(item.studentUid, ach.id)}
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <div style={{ fontSize: '12px', color: isVerified ? '#16a34a' : '#64748b', fontWeight: 600 }}>
                                  {isVerified ? `+${ach.score ?? 0} баллов` : 'Отклонено'}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {/* АДМИНИСТРАТОР: 2. Вкладка Организации */}
            {isAdmin && adminTab === 'organizations' && (
              <section aria-labelledby="admin-orgs-heading">
                <div className="dashboard-title-row">
                  <div>
                    <h2 id="admin-orgs-heading">Заявки организаций</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '4px 0 0' }}>
                      Верификация компаний, образовательных агентств и фондов, управление подписками.
                    </p>
                  </div>
                  <button type="button" className="text-button" onClick={() => void loadAdminData()}>
                    Обновить данные
                  </button>
                </div>

                {loadingAdmin ? (
                  <p style={{ color: '#64748b' }}>Загрузка организаций…</p>
                ) : adminOrgs.length === 0 ? (
                  <div className="empty-state-card" style={{ textAlign: 'center', padding: '40px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                    <h3 style={{ margin: 0, color: '#0f172a' }}>Заявок организаций пока нет</h3>
                    <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '13px' }}>Здесь будут отображаться зарегистрированные компании и фонды.</p>
                  </div>
                ) : (
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Организация / БИН</th>
                        <th>Тип</th>
                        <th>Представитель / Контакты</th>
                        <th>Документ</th>
                        <th>Верификация</th>
                        <th>Подписка (50k ₸)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminOrgs.map(org => (
                        <tr key={org.uid}>
                          <td>
                            <strong>{org.name}</strong>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>БИН: {org.businessId}</div>
                          </td>
                          <td>
                            <span style={{ fontSize: '12px' }}>{organizationTypes[org.type as keyof typeof organizationTypes] || org.type}</span>
                          </td>
                          <td>
                            <div>{org.representative} ({org.position})</div>
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{org.email} • {org.phone}</div>
                          </td>
                          <td>
                            {org.proofUrl ? (
                              <button
                                type="button"
                                className="text-link-btn"
                                onClick={() => setViewingPhotoUrl(org.proofUrl)}
                              >
                                Документ
                              </button>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '12px' }}>Нет файла</span>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className={org.verified ? 'badge-status-verified' : 'badge-status-unverified'}>
                                {org.verified ? 'verified' : 'unverified'}
                              </span>
                              <button
                                type="button"
                                className="btn-toggle-verif"
                                onClick={() => handleAdminToggleVerification(org.uid, org.verified)}
                              >
                                {org.verified ? 'Снять' : 'Одобрить'}
                              </button>
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className={org.hasSubscription ? 'badge-sub-active' : 'badge-sub-inactive'}>
                                {org.hasSubscription ? 'Активна' : 'Не активна'}
                              </span>
                              <button
                                type="button"
                                className="btn-toggle-sub"
                                onClick={() => handleAdminToggleSubscription(org.uid, org.hasSubscription)}
                              >
                                {org.hasSubscription ? 'Отключить' : 'Активировать'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {/* ОРГАНИЗАЦИЯ & АДМИН: Вкладка Лидерборд */}
            {((!isAdmin && orgTab === 'leaderboard') || (isAdmin && adminTab === 'leaderboard')) && (
              <section aria-labelledby="org-leaderboard-heading">
                <div className="dashboard-title-row">
                  <div>
                    <h2 id="org-leaderboard-heading">Лидерборд талантов Казахстана</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '14px', margin: '4px 0 0' }}>
                      Кликните правой кнопкой мыши по ученику, чтобы запросить контакты для рекрутинга и грантов.
                    </p>
                  </div>

                  {/* Фильтр по регионам Казахстана */}
                  <div className="filter-group">
                    <select
                      className="filter-select"
                      value={selectedRegionFilter}
                      onChange={e => {
                        if (!isAdmin && !application?.hasSubscription && e.target.value !== 'Все регионы') {
                          setError('Поиск и фильтрация по регионам Казахстана доступны только по активной подписке (50 000 ₸).');
                          setOrgTab('subscription');
                          return;
                        }
                        setSelectedRegionFilter(e.target.value);
                      }}
                    >
                      <option value="Все регионы">Все регионы</option>
                      {KAZAKHSTAN_REGIONS.map(reg => (
                        <option key={reg} value={reg}>
                          {reg} {!isAdmin && !application?.hasSubscription ? '🔒 (Подписка)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="leaderboard-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Место</th>
                        <th>Ученик</th>
                        <th>Класс</th>
                        <th>Регион</th>
                        <th>TalentScore</th>
                        <th>Олимпиад</th>
                        <th style={{ width: '180px' }}>Средний балл</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgFilteredLeaderboard.map((item, idx) => {
                        const rankClass = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : '';
                        const pct = item.averagePercent;
                        const pctClass = pct !== null && pct >= 80 ? 'score-green' : pct !== null && pct >= 65 ? 'score-yellow' : pct !== null ? 'score-red' : '';

                        return (
                          <tr
                            key={item.uid}
                            onContextMenu={e => {
                              e.preventDefault();
                              setContextMenu({ x: e.clientX, y: e.clientY, student: item });
                            }}
                            style={{ cursor: 'context-menu' }}
                            title="Нажмите правой кнопкой мыши, чтобы запросить контакты"
                          >
                            <td>
                              <span className={`leaderboard-rank-tag ${rankClass}`}>
                                #{idx + 1}
                              </span>
                            </td>
                            <td>
                              <div className="leader-name-wrap">
                                <span className="leader-avatar">{item.name.charAt(0)}</span>
                                <span style={{ fontWeight: 600 }}>{item.name}</span>
                              </div>
                            </td>
                            <td>
                              <span className="leader-class">{item.classLabel}</span>
                            </td>
                            <td>
                              <span className="region-tag">{item.region || 'г. Астана'}</span>
                            </td>
                            <td>
                              <span className="talent-score-pill">
                                {item.talentScore} баллов
                              </span>
                            </td>
                            <td>
                              <span className="achievements-count-tag">
                                {item.achievementsCount}
                              </span>
                            </td>
                            <td>
                              <div className="preview-percent-wrap">
                                <div className="preview-percent-bar-track">
                                  <div
                                    className={`preview-percent-bar-fill ${pctClass}`}
                                    style={{ width: `${pct !== null ? Math.min(100, Math.max(0, pct)) : 0}%` }}
                                  />
                                </div>
                                <span className={`preview-percent-value ${pctClass}`}>
                                  {pct !== null ? `${pct}%` : '—'}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ОРГАНИЗАЦИЯ: Вкладка Подписка */}
            {!isAdmin && orgTab === 'subscription' && (
              <section className="subscription-section" aria-labelledby="subscription-heading">
                <div className="subscription-card">
                  <div className="sub-badge-row">
                    <span className={application?.hasSubscription ? 'badge-sub-active' : 'badge-sub-inactive'}>
                      {application?.hasSubscription ? 'Подписка активна' : 'Подписка не оформлена'}
                    </span>
                  </div>
                  <h2 id="subscription-heading" style={{ margin: '0 0 8px', fontSize: '24px', color: '#0f172a' }}>
                    EduID Таланты для организаций
                  </h2>
                  <p className="sub-description">
                    Прямой доступ к контактам сильнейших олимпиадников, хакатонщиков и спортсменов Казахстана для хантинга, грантов и стажировок.
                  </p>

                  <div className="subscription-price-box">
                    <span className="price-val">50 000 ₸</span>
                    <span className="price-period">/ месяц</span>
                  </div>

                  <ul className="sub-perks-list">
                    <li>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span><strong>Запрос прямых контактов:</strong> кликните правой кнопкой мыши по ученику в лидерборде — ученик и родитель получат запрос на подтверждение связи.</span>
                    </li>
                    <li>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span><strong>Региональный фильтр:</strong> расширенный поиск и таргетинг олимпиадников по 20 регионам и областям Казахстана.</span>
                    </li>
                    <li>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span><strong>Подтверждённые портфолио:</strong> доступ к проверенным дипломам, TalentScore и реальным оценкам из школьных систем.</span>
                    </li>
                  </ul>

                  <div className="sub-cta-box">
                    <a
                      href="https://t.me/ttfotg"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="primary tg-buy-btn"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.19-.08-.05-.19-.02-.27 0-.12.03-1.99 1.27-5.61 3.72-.53.36-1.01.54-1.44.53-.47-.01-1.38-.27-2.06-.49-.83-.27-1.49-.42-1.43-.88.03-.24.38-.49 1.03-.75 4.04-1.76 6.74-2.92 8.09-3.49 3.85-1.61 4.65-1.89 5.17-1.9.11 0 .37.03.54.17.14.12.18.28.2.45-.01.07.01.21 0 .32z"/></svg>
                      <span>Купить подписку в Telegram (@ttfotg)</span>
                    </a>
                    <p className="sub-note">
                      После оплаты в Telegram администратор активирует подписку для вашего аккаунта.
                    </p>
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>

        {/* Контекстное меню при правом клике */}
        {contextMenu && (
          <div
            className="custom-context-menu"
            style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          >
            <button
              type="button"
              className="context-menu-item"
              onClick={() => handleRequestContacts(contextMenu.student.uid, contextMenu.student.name)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span>Запросить контакты</span>
            </button>
          </div>
        )}

        {/* Просмотр полного фото (Lightbox) */}
        {viewingPhotoUrl && (
          <div
            className="lightbox-overlay"
            onClick={() => setViewingPhotoUrl(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Просмотр документа"
          >
            <div className="lightbox-dialog" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="lightbox-close"
                onClick={() => setViewingPhotoUrl(null)}
                aria-label="Закрыть"
              >
                ×
              </button>
              <img src={viewingPhotoUrl} alt="Документ" className="lightbox-img" />
            </div>
          </div>
        )}
      </div>
    );
  }

  const registering = mode === 'register';
  const organization = audience === 'organization';
  const organizationForm = organization && registering;
  const title = organizationForm ? 'Регистрация организации' : registering ? 'Создать профиль' : 'Вход в EduID';
  const description = organizationForm ? 'Заполните данные организации и подтвердите полномочия представителя.'
    : organization ? 'Войдите по корпоративной почте и паролю EduID.' : registering ? 'Подключите школьный сервис, чтобы подтвердить профиль ученика.' : 'Войдите с данными школьного аккаунта.';

  return <div className="access-page">
    <main className={`access-main ${organizationForm ? 'wide' : ''}`}>
      <header className="access-header"><Logo />{session && <button className="text-button" onClick={() => void exit()}>Выйти</button>}</header>
      <section className="access-content" aria-labelledby="access-title">
        {!session && <nav className="access-tabs" aria-label="Вход и регистрация">
          <button type="button" disabled={busy} aria-pressed={!registering} onClick={() => changeMode('login')}>Вход</button>
          <button type="button" disabled={busy} aria-pressed={registering} onClick={() => changeMode('register')}>Регистрация</button>
        </nav>}
        <h1 id="access-title">{title}</h1><p className="description">{description}</p>
        <form onSubmit={submit} key={`${mode}:${audience}`}>
          <fieldset className="access-fields" disabled={busy}>
            {organizationForm ? <OrganizationFields /> : organization ? <>
              <Field label="Корпоративная почта"><input name="email" type="email" autoComplete="email" placeholder="name@company.kz" required /></Field>
              <Password organization={true} register={false} />
            </> : <>
              <fieldset className="school-picker"><legend>Школьный сервис</legend><div className="school-options">
                {(Object.entries(providers) as [SchoolSource, string][]).map(([value, label]) => <label key={value}>
                  <input type="radio" name="source" checked={source === value} onChange={() => setSource(value)} /><span>{label}</span>
                </label>)}
              </div></fieldset>
              {registering && (
                <Field label="Регион Казахстана">
                  <select name="region" defaultValue={source === 'sush' ? 'Актюбинская область' : 'г. Астана'} required>
                    {KAZAKHSTAN_REGIONS.map(reg => <option key={reg} value={reg}>{reg}</option>)}
                  </select>
                </Field>
              )}
              <Field label={source === 'sush' ? 'ИИН' : 'Логин BilimClass'}>
                <input key={source} name="login" autoComplete="username" inputMode={source === 'sush' ? 'numeric' : 'text'}
                  pattern={source === 'sush' ? '[0-9]{12}' : undefined} maxLength={source === 'sush' ? 12 : 128}
                  placeholder={source === 'sush' ? '12 цифр' : 'Логин, выданный школой'} required />
              </Field>
              <Password organization={false} register={registering} />
            </>}
            {!organization && registering && <label className="consent"><input type="checkbox" name="consent" required />
              <span>Разрешаю EduID получить данные моего профиля и оценки из выбранного школьного сервиса.</span></label>}
            {error && <p className="message" role="alert">{error}</p>}
            <button type="submit" className="primary">{busy ? organization ? 'Обрабатываем запрос…' : registering ? 'Проверяем школьный аккаунт…' : 'Входим в EduID…' : organizationForm ? 'Отправить заявку' : registering ? 'Создать профиль' : 'Войти'}</button>
          </fieldset>
        </form>
        {!session && <div className="audience-switch"><button className="text-button" onClick={switchAudience} disabled={busy}>{organization ? 'Я ученик' : 'Я не ученик'}</button>
          <span>{organization ? 'Вход через школьный сервис' : 'Вход и регистрация для организаций'}</span></div>}
      </section>
    </main>
    <IdentityArt organization={organization} />
  </div>;
}
