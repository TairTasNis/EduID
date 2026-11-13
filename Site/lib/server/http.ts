import 'server-only';

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

export function configurationError(...settings: string[]) {
  console.error(`EduID configuration: check ${settings.join(', ')}`);
  const hint = process.env.NODE_ENV === 'development' ? ' Проверьте .env.local по инструкции в README.md.' : '';
  return new HttpError(503, `Серверная настройка EduID не завершена.${hint}`);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const caller = URL.canParse(origin) ? new URL(origin) : null;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  const allowedProtocol = caller?.protocol === 'https:' || (caller?.protocol === 'http:' && process.env.VERCEL !== '1');
  if (!allowedProtocol || caller?.host !== host) throw new HttpError(403, 'Откройте форму на сайте EduID.');
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function failure(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  console.error('EduID request failed', error instanceof Error ? error.name : 'unknown');
  return json({ error: 'Сервис EduID пока недоступен. Попробуйте позже.' }, 503);
}
