/* Cloudflare Pages Function — POST /api/whatsapp
   Valida Turnstile no servidor e só então devolve o link do WhatsApp.
   O número vive apenas na variável de ambiente WHATSAPP_NUMBER. */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'whatsapp';
const MAX_BODY_BYTES = 2048;     // reduzido: token + pouco overhead
const MAX_TOKEN_LENGTH = 2048;
const DEFAULT_MESSAGE = 'Olá! Vim pelo site da NANPA Tecnologia e gostaria de mais informações.';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 5;
const ABUSE_WINDOW_MS = 10 * 60_000;
const ABUSE_MAX_PER_WINDOW = 20;
const ABUSE_BLOCK_MS = 15 * 60_000;

// Best-effort por isolate; a regra de Rate Limiting do WAF é a barreira principal.
const hits = new Map();

const AUTOMATION_UA = /\b(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|java\/|okhttp|libwww-perl|scrapy|node-fetch|axios|headlesschrome|phantomjs|puppeteer|playwright|selenium)\b/i;

function json(status, body, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow',
            ...extraHeaders,
        },
    });
}

const fail = (status, code, extraHeaders) => json(status, { ok: false, error: code }, extraHeaders);

function allowedHosts(env, requestUrl) {
    const configured = (env.ALLOWED_HOSTNAMES || '')
        .split(',')
        .map(h => h.trim().toLowerCase())
        .filter(Boolean);
    return configured.length ? configured : [requestUrl.hostname.toLowerCase()];
}

function isAllowedOrigin(request, hosts) {
    const source = request.headers.get('Origin') || request.headers.get('Referer');
    if (!source) return false;
    try {
        const url = new URL(source);
        const localDev = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (url.protocol !== 'https:' && !localDev) return false;
        return hosts.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function checkRateLimit(key, now) {
    let entry = hits.get(key);
    if (!entry) {
        entry = { times: [], blockedUntil: 0 };
        hits.set(key, entry);
    }
    if (entry.blockedUntil > now) {
        return Math.ceil((entry.blockedUntil - now) / 1000);
    }
    entry.times = entry.times.filter(t => now - t < ABUSE_WINDOW_MS);
    entry.times.push(now);

    if (entry.times.length > ABUSE_MAX_PER_WINDOW) {
        entry.blockedUntil = now + ABUSE_BLOCK_MS;
        return Math.ceil(ABUSE_BLOCK_MS / 1000);
    }
    const recent = entry.times.filter(t => now - t < RATE_WINDOW_MS).length;
    if (recent > RATE_MAX_PER_WINDOW) {
        return Math.ceil(RATE_WINDOW_MS / 1000);
    }

    if (hits.size > 5000) {
        for (const [k, v] of hits) {
            if (v.blockedUntil <= now && v.times.every(t => now - t >= ABUSE_WINDOW_MS)) hits.delete(k);
        }
    }
    return 0;
}

async function verifyTurnstile(token, ip, secret) {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    form.append('idempotency_key', crypto.randomUUID());

    const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
    return res.json();
}

export async function onRequestPost({ request, env }) {
    try {
        const url = new URL(request.url);
        const hosts = allowedHosts(env, url);

        const phone = (env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
        if (!env.TURNSTILE_SECRET_KEY || !/^\d{10,15}$/.test(phone)) {
            console.error('whatsapp: variáveis de ambiente ausentes ou inválidas');
            return fail(503, 'unavailable');
        }

        // CSRF: exige Origin/Referer do próprio site, fetch same-origin e header customizado (força preflight CORS).
        if (!isAllowedOrigin(request, hosts)) return fail(403, 'forbidden');
        const fetchSite = request.headers.get('Sec-Fetch-Site');
        if (fetchSite && fetchSite !== 'same-origin') return fail(403, 'forbidden');
        if (request.headers.get('X-Requested-With') !== 'nanpa-wa') return fail(403, 'forbidden');

        // Sinal complementar apenas; o Turnstile continua sendo obrigatório.
        const ua = request.headers.get('User-Agent') || '';
        if (!ua || AUTOMATION_UA.test(ua)) return fail(403, 'forbidden');

        const ip = request.headers.get('CF-Connecting-IP') || '';
        const now = Date.now();
        let retryAfter = checkRateLimit(`ip:${ip || 'unknown'}`, now);
        if (!retryAfter && env.WA_RATE_LIMITER) {
            const { success } = await env.WA_RATE_LIMITER.limit({ key: `wa:${ip}` });
            if (!success) retryAfter = 60;
        }
        if (retryAfter) return fail(429, 'rate_limited', { 'Retry-After': String(retryAfter) });

        const contentType = request.headers.get('Content-Type') || '';
        if (!contentType.toLowerCase().startsWith('application/json')) return fail(415, 'bad_request');

        // Rejeita requests sem Content-Length declarado ou acima do limite
        const declaredLength = Number(request.headers.get('Content-Length') || 0);
        if (declaredLength > MAX_BODY_BYTES) return fail(413, 'bad_request');
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return fail(413, 'bad_request');

        let body;
        try {
            body = JSON.parse(raw);
        } catch {
            return fail(400, 'bad_request');
        }

        // Aceita apenas objetos planos com campo token string
        if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_request');
        const token = typeof body.token === 'string' ? body.token : '';
        // Token Turnstile: apenas alfanumérico, hífens, underscores, pontos e dois-pontos
        if (!token || token.length < 20 || token.length > MAX_TOKEN_LENGTH || !/^[\w.\-:]+$/.test(token)) {
            return fail(400, 'bad_request');
        }

        let outcome;
        try {
            outcome = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET_KEY);
        } catch (err) {
            console.error('whatsapp: falha no siteverify', err && err.message);
            return fail(502, 'verification_unavailable');
        }

        const validHost = outcome.hostname && hosts.includes(String(outcome.hostname).toLowerCase());
        if (!outcome.success || outcome.action !== TURNSTILE_ACTION || !validHost) {
            // Log para monitoramento sem vazar detalhes ao cliente
            console.warn('whatsapp: verificação falhou', JSON.stringify({
                success: outcome.success,
                action: outcome.action,
                hostname: outcome.hostname,
                errors: outcome['error-codes'],
            }));
            return fail(403, 'verification_failed');
        }

        const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(DEFAULT_MESSAGE)}`;
        return json(200, { ok: true, url: waUrl });
    } catch (err) {
        console.error('whatsapp: erro inesperado', err && err.message);
        return fail(500, 'internal_error');
    }
}

// Responde OPTIONS para CORS preflight (o browser envia antes do POST com header customizado).
// Como o fetch é sempre same-origin, não precisamos abrir CORS cross-origin;
// respondemos 204 apenas para o preflight não falhar por timeout.
export function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
            'Access-Control-Max-Age': '86400',
            'Cache-Control': 'no-store',
        },
    });
}

// Qualquer outro método HTTP → 405
export function onRequest() {
    return fail(405, 'method_not_allowed', { Allow: 'POST, OPTIONS' });
}
