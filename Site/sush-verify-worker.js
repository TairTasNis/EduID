import { createHmac, randomUUID } from 'node:crypto';
import { scrapeSush } from './lib/server/sush/scrape-sush.js';
import { SushClient } from './lib/server/sush/sush-client.js';
import { decodeSessionToken, encodeSessionToken } from './lib/server/sush/session-token.js';

const allowedOrigins = new Set([
  'https://edu.ilve.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function getCorsHeaders(reqOrigin) {
  const allowOrigin = allowedOrigins.has(reqOrigin) ? reqOrigin : 'https://edu.ilve.dev';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const reqOrigin = request.headers.get('Origin') || '';
    const cors = getCorsHeaders(reqOrigin);
    const reply = (body, status = 200) => Response.json(body, { status, headers: cors });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (reqOrigin && !allowedOrigins.has(reqOrigin)) {
      return reply({ error: 'Forbidden' }, 403);
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/verify') {
      return reply({ error: 'Not found' }, 404);
    }

    if (!env.EDUID_SUSH_PROOF_KEY || env.EDUID_SUSH_PROOF_KEY.length < 32) {
      return reply({ error: 'Service unavailable' }, 503);
    }

    if (Number(request.headers.get('content-length')) > 16384) {
      return reply({ error: 'Invalid request' }, 400);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return reply({ error: 'Invalid request' }, 400);
    }

    const clientIp = request.headers.get('CF-Connecting-IP');
    const client = new SushClient({
      baseUrl: 'https://sms.akb.nis.edu.kz',
      proxyUrl: '',
      fetchImpl: (u, options = {}) => {
        const headers = new Headers(options.headers);
        headers.set('Origin', 'https://sms.akb.nis.edu.kz');
        headers.set('Referer', 'https://sms.akb.nis.edu.kz/');
        if (clientIp) headers.set('X-Forwarded-For', clientIp);
        return fetch(u, { ...options, headers });
      },
    });

    if (input.action === 'refresh_captcha') {
      if (input.sessionToken) {
        const restored = decodeSessionToken(input.sessionToken);
        if (restored) client.setCookies(restored);
      }
      const refreshed = await client.refreshCaptcha();
      const newSession = encodeSessionToken(client.getCookies());
      return reply({
        captchaRequired: true,
        captchaType: refreshed.captchaType,
        captchaData: refreshed.captchaData,
        sessionToken: newSession,
      });
    }

    if (!/^\d{12}$/.test(input.login || '') || typeof input.password !== 'string' || !input.password || input.password.length > 256) {
      return reply({ error: 'Проверьте ИИН и пароль.' }, 400);
    }

    const captcha = typeof input.captcha === 'string' && input.captcha.trim() ? input.captcha.trim() : undefined;
    const sessionToken = typeof input.sessionToken === 'string' && input.sessionToken.trim() ? input.sessionToken.trim() : undefined;

    const result = await scrapeSush({
      client,
      iin: input.login,
      password: input.password,
      captcha,
      sessionToken,
      mode: 'profile',
    });

    if (result.captchaRequired) {
      return reply({
        code: 'sush_captcha_required',
        captchaRequired: true,
        captchaType: result.captchaType ?? 1,
        captchaData: result.captchaData ?? null,
        sessionToken: result.sessionToken ?? null,
        error: result.message || 'СУШ запросил подтверждение (CAPTCHA).',
      }, 428);
    }

    if (!result.success || !result.profile?.fullName || !result.profile?.className || !result.years?.length) {
      return reply({
        error: result.message || 'СУШ не подтвердил профиль. Проверьте данные для входа.',
      }, 422);
    }

    const mac = (value) => createHmac('sha256', env.EDUID_SUSH_PROOF_KEY).update(value).digest('base64url');
    const proof = {
      login: input.login,
      credential: mac(`credential\0${input.login}\0${input.password}`),
      profile: result.profile,
      years: result.years,
      exp: Date.now() + 120000,
      nonce: randomUUID(),
    };
    const encoded = Buffer.from(JSON.stringify(proof)).toString('base64url');
    return reply({ proof: `${encoded}.${mac(`proof\0${encoded}`)}` });
  },
};
