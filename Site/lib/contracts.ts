import { z } from 'zod';

export const providers = { bilimclass: 'BilimClass', sush: 'СУШ НИШ Актобе' } as const;
export const schoolSources = ['bilimclass', 'sush'] as const;
export type SchoolSource = typeof schoolSources[number];
export const organizationTypes = {
  university: 'Казахстанский вуз', agency: 'Образовательное агентство',
  company: 'Компания', foundation: 'Фонд или грантодатель',
} as const;

export const KAZAKHSTAN_REGIONS = [
  'г. Астана',
  'г. Алматы',
  'г. Шымкент',
  'Абайская область',
  'Акмолинская область',
  'Актюбинская область',
  'Алматинская область',
  'Атырауская область',
  'Восточно-Казахстанская область',
  'Жамбылская область',
  'Жетысуская область',
  'Западно-Казахстанская область',
  'Карагандинская область',
  'Костанайская область',
  'Кызылординская область',
  'Мангистауская область',
  'Павлодарская область',
  'Северо-Казахстанская область',
  'Туркестанская область',
  'Улытауская область',
] as const;

export type StudentProfile = {
  fullName: string; classNumber: number; classLetter: string; classLabel: string; source: SchoolSource; region?: string;
};
export type ImportStatus = {
  status: 'running' | 'complete' | 'failed'; completed: number; total: number;
  currentYear?: string; message?: string; updatedAt: number;
};
export type OrganizationStatus = {
  name: string;
  status: 'unverified' | 'verified' | 'pending_review';
  verified?: boolean;
  hasSubscription?: boolean;
  email?: string;
  representative?: string;
  submittedAt: number;
};

const businessId = z.string().trim().regex(/^\d{12}$/, 'Введите 12 цифр.');
export const studentInput = z.object({
  action: z.enum(['login', 'register']), source: z.enum(schoolSources), login: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256), consent: z.boolean().optional(), region: z.string().nullish(),
}).refine(input => input.source !== 'sush' || /^\d{12}$/.test(input.login));

const publicMail = new Set(['gmail.com', 'googlemail.com', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'internet.ru',
  'yandex.ru', 'yandex.kz', 'yandex.com', 'ya.ru', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'yahoo.com', 'proton.me', 'protonmail.com', 'rambler.ru', 'aol.com', 'gmx.com']);
export const corporateEmail = z.string().email('Укажите корректный email адрес.').max(254);

export const maxDocumentBytes = 3 * 1024 * 1024;
export const documentTypes = ['application/pdf', 'image/jpeg', 'image/png'];
export const organizationInput = z.object({
  businessId, name: z.string().trim().min(2).max(200),
  type: z.enum(['university', 'agency', 'company', 'foundation']),
  email: corporateEmail, phone: z.string().trim().regex(/^\+?[\d ()-]{7,24}$/)
    .refine(phone => /^\d{7,15}$/.test(phone.replace(/\D/g, ''))),
  representative: z.string().trim().min(3).max(140), position: z.string().trim().min(2).max(120),
});
