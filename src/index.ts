import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

type Env = {
  DB: D1Database; VIDEOS: R2Bucket; RATE: KVNamespace; ASSETS: Fetcher;
  APP_URL: string; BRAND: string; PRICE_LABEL: string;
  STRIPE_PRICE_ID: string; STRIPE_SECRET_KEY: string; STRIPE_WEBHOOK_SECRET: string;
  PAYPAL_ENV: string; PAYPAL_CLIENT_ID: string; PAYPAL_CLIENT_SECRET: string;
  PAYPAL_PLAN_ID: string; PAYPAL_WEBHOOK_ID: string;
};
type User = { id: string; email: string; name: string; role: string; stripe_customer_id: string | null };
const app = new Hono<{ Bindings: Env; Variables: { user: User | null } }>();

const now = () => Math.floor(Date.now() / 1000);
const SESSION_DAYS = 30;

/* ---------- crypto helpers ---------- */
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const randomToken = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hashPassword(pw: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  // 100k iterations is the maximum Workers allow for PBKDF2.
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return b64(bits);
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return [...sig].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/* ---------- security headers + session ---------- */
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('X-Frame-Options', 'DENY');
});

app.use('/api/*', async (c, next) => {
  c.set('user', null);
  const token = getCookie(c, 'sid');
  if (token) {
    const row = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.stripe_customer_id FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`
    ).bind(await sha256(token), now()).first<User>();
    if (row) c.set('user', row);
  }
  await next();
});

async function hasActiveSub(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM subscriptions WHERE user_id = ?1 AND (
       status IN ('active','trialing') OR (status = 'canceled' AND current_period_end > ?2)
     ) LIMIT 1`
  ).bind(userId, now()).first();
  return !!row;
}

async function startSession(c: any, userId: string) {
  const token = randomToken();
  await c.env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now() + SESSION_DAYS * 86400).run();
  setCookie(c, 'sid', token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}

async function rateLimit(env: Env, key: string, max: number, windowSec: number) {
  const k = `rl:${key}`;
  const n = parseInt((await env.RATE.get(k)) || '0', 10);
  if (n >= max) return false;
  await env.RATE.put(k, String(n + 1), { expirationTtl: windowSec });
  return true;
}

/* ---------- public config ---------- */
app.get('/api/config', (c) =>
  c.json({
    brand: c.env.BRAND, priceLabel: c.env.PRICE_LABEL,
    paypal: { clientId: c.env.PAYPAL_CLIENT_ID, planId: c.env.PAYPAL_PLAN_ID },
  })
);

/* ---------- auth ---------- */
app.post('/api/auth/signup', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  if (!(await rateLimit(c.env, `signup:${ip}`, 10, 3600))) return c.json({ error: 'Too many attempts. Please try again later.' }, 429);
  const { name, email, password } = await c.req.json<any>().catch(() => ({}));
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return c.json({ error: 'Enter a valid email address.' }, 400);
  if (String(password || '').length < 10) return c.json({ error: 'Use a password with at least 10 characters.' }, 400);
  if (!String(name || '').trim()) return c.json({ error: 'Enter your name.' }, 400);
  const salt = randomToken(16);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare('INSERT INTO users (id,email,name,password_hash,salt,created_at) VALUES (?,?,?,?,?,?)')
      .bind(id, e, String(name).trim().slice(0, 80), await hashPassword(password, salt), salt, now()).run();
  } catch {
    return c.json({ error: 'An account with this email already exists. Try signing in.' }, 409);
  }
  await startSession(c, id);
  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const { email, password } = await c.req.json<any>().catch(() => ({}));
  const e = String(email || '').trim().toLowerCase();
  if (!(await rateLimit(c.env, `login:${ip}:${e}`, 8, 900))) return c.json({ error: 'Too many attempts. Wait 15 minutes and try again.' }, 429);
  const u = await c.env.DB.prepare('SELECT id, password_hash, salt FROM users WHERE email = ?').bind(e).first<any>();
  const hash = await hashPassword(String(password || ''), u?.salt || 'x');
  if (!u || !safeEqual(hash, u.password_hash)) return c.json({ error: 'Email or password is incorrect.' }, 401);
  await startSession(c, u.id);
  return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, 'sid');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, 'sid', { path: '/' });
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ user: null });
  const sub = await c.env.DB.prepare(
    'SELECT provider, status, current_period_end FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).bind(u.id).first<any>();
  return c.json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role, hasStripe: !!u.stripe_customer_id },
    subscription: { active: await hasActiveSub(c.env, u.id), provider: sub?.provider ?? null, status: sub?.status ?? null, renewsAt: sub?.current_period_end ?? null },
  });
});

/* ---------- classes ---------- */
const PUBLIC_COLS = 'id, slug, title, description, instructor, style, level, duration_min, is_free_preview, thumb_key';

app.get('/api/classes', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${PUBLIC_COLS} FROM classes WHERE published = 1 ORDER BY created_at DESC`).all();
  return c.json({ classes: results });
});

app.get('/api/classes/:slug', async (c) => {
  const cls = await c.env.DB.prepare(`SELECT ${PUBLIC_COLS} FROM classes WHERE slug = ? AND published = 1`).bind(c.req.param('slug')).first<any>();
  if (!cls) return c.json({ error: 'Class not found.' }, 404);
  const u = c.get('user');
  let access: 'granted' | 'login' | 'subscribe' = 'login';
  if (cls.is_free_preview && u) access = 'granted';
  else if (u) access = (await hasActiveSub(c.env, u.id)) ? 'granted' : 'subscribe';
  return c.json({ class: cls, access });
});

app.get('/api/thumb/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT thumb_key FROM classes WHERE id = ? AND published = 1').bind(c.req.param('id')).first<any>();
  if (!row?.thumb_key) return c.notFound();
  const obj = await c.env.VIDEOS.get(row.thumb_key);
  if (!obj) return c.notFound();
  const h = new Headers(); obj.writeHttpMetadata(h);
  h.set('Cache-Control', 'public, max-age=86400');
  return new Response(obj.body, { headers: h });
});

/* Protected video stream. The R2 bucket is private; the only way to the file is
   through this route, which checks the session and subscription on every request
   (including every Range request the browser makes while seeking). */
app.get('/api/video/:id', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'Sign in to watch.' }, 401);
  const cls = await c.env.DB.prepare('SELECT r2_key, is_free_preview FROM classes WHERE id = ? AND published = 1').bind(c.req.param('id')).first<any>();
  if (!cls) return c.json({ error: 'Class not found.' }, 404);
  if (!cls.is_free_preview && !(await hasActiveSub(c.env, u.id))) return c.json({ error: 'An active membership is required.' }, 403);

  const rangeHeader = c.req.header('range');
  const obj = await c.env.VIDEOS.get(cls.r2_key, rangeHeader ? { range: c.req.raw.headers } : undefined);
  if (!obj) return c.json({ error: 'Video unavailable.' }, 404);

  const h = new Headers(); obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('Accept-Ranges', 'bytes');
  h.set('Cache-Control', 'private, no-store');
  h.set('Content-Disposition', 'inline');
  let status = 200;
  if (rangeHeader && obj.range) {
    const r = obj.range as { offset?: number; length?: number; suffix?: number };
    const start = r.offset ?? Math.max(0, obj.size - (r.suffix ?? 0));
    const len = r.length ?? obj.size - start;
    h.set('Content-Range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    h.set('Content-Length', String(len));
    status = 206;
  } else h.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status, headers: h });
});

/* ---------- admin ---------- */
app.post('/api/admin/classes', async (c) => {
  const u = c.get('user');
  if (!u || u.role !== 'admin') return c.json({ error: 'Not allowed.' }, 403);
  const b = await c.req.json<any>().catch(() => ({}));
  for (const k of ['slug', 'title', 'description', 'instructor', 'style', 'level', 'r2_key']) if (!b[k]) return c.json({ error: `Missing ${k}.` }, 400);
  await c.env.DB.prepare(
    `INSERT INTO classes (id,slug,title,description,instructor,style,level,duration_min,r2_key,thumb_key,is_free_preview,published,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), b.slug, b.title, b.description, b.instructor, b.style, b.level, Number(b.duration_min) || 20,
    b.r2_key, b.thumb_key ?? null, b.is_free_preview ? 1 : 0, b.published ? 1 : 0, now()).run();
  return c.json({ ok: true });
});

/* ---------- Stripe ---------- */
async function stripeCall(env: Env, path: string, params: Record<string, string>) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = (await res.json()) as any;
  if (!res.ok) throw new Error(j?.error?.message || 'Stripe error');
  return j;
}

app.post('/api/billing/stripe/checkout', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'Sign in first.' }, 401);
  if (await hasActiveSub(c.env, u.id)) return c.json({ error: 'You already have an active membership.' }, 409);
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': c.env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    client_reference_id: u.id,
    success_url: `${c.env.APP_URL}/#/welcome`,
    cancel_url: `${c.env.APP_URL}/#/pricing`,
    'subscription_data[metadata][user_id]': u.id,
  };
  if (u.stripe_customer_id) params.customer = u.stripe_customer_id; else params.customer_email = u.email;
  const s = await stripeCall(c.env, '/checkout/sessions', params);
  return c.json({ url: s.url });
});

app.post('/api/billing/stripe/portal', async (c) => {
  const u = c.get('user');
  if (!u?.stripe_customer_id) return c.json({ error: 'No card subscription found.' }, 400);
  const s = await stripeCall(c.env, '/billing_portal/sessions', { customer: u.stripe_customer_id, return_url: `${c.env.APP_URL}/#/account` });
  return c.json({ url: s.url });
});

async function verifyStripe(body: string, header: string, secret: string) {
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now() - parseInt(t, 10)) > 300) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  return sigs.some((s) => safeEqual(s, expected));
}

async function upsertSub(env: Env, userId: string, provider: string, subId: string, status: string, periodEnd: number | null) {
  await env.DB.prepare(
    `INSERT INTO subscriptions (user_id, provider, provider_sub_id, status, current_period_end, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6)
     ON CONFLICT(provider, provider_sub_id) DO UPDATE SET status = ?4, current_period_end = COALESCE(?5, current_period_end), updated_at = ?6`
  ).bind(userId, provider, subId, status, periodEnd, now()).run();
}

app.post('/api/webhooks/stripe', async (c) => {
  const body = await c.req.text();
  if (!(await verifyStripe(body, c.req.header('stripe-signature') || '', c.env.STRIPE_WEBHOOK_SECRET))) return c.text('Bad signature', 400);
  const event = JSON.parse(body);
  const o = event.data.object;
  if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && o.client_reference_id) {
    await c.env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(o.customer, o.client_reference_id).run();
    await upsertSub(c.env, o.client_reference_id, 'stripe', o.subscription, 'active', null);
  } else if (event.type.startsWith('customer.subscription.')) {
    const userId = o.metadata?.user_id ||
      (await c.env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(o.customer).first<any>())?.id;
    if (userId) {
      const status = event.type.endsWith('.deleted') || o.status === 'canceled' ? 'canceled'
        : o.status === 'active' || o.status === 'trialing' ? o.status : 'past_due';
      const end = o.current_period_end ?? o.items?.data?.[0]?.current_period_end ?? null;
      await upsertSub(c.env, userId, 'stripe', o.id, status, end);
    }
  }
  return c.text('ok');
});

/* ---------- PayPal ---------- */
const ppBase = (env: Env) => (env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
async function ppToken(env: Env) {
  const res = await fetch(ppBase(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('PayPal auth failed');
  return ((await res.json()) as any).access_token as string;
}
async function ppGetSub(env: Env, id: string) {
  const res = await fetch(`${ppBase(env)}/v1/billing/subscriptions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${await ppToken(env)}` } });
  if (!res.ok) throw new Error('PayPal subscription lookup failed');
  return (await res.json()) as any;
}
async function syncPaypal(env: Env, id: string, expectUser?: string) {
  const s = await ppGetSub(env, id);
  if (s.plan_id !== env.PAYPAL_PLAN_ID) throw new Error('Unexpected plan');
  const userId = s.custom_id as string;
  if (!userId || (expectUser && userId !== expectUser)) throw new Error('Subscription does not belong to this user');
  const status = s.status === 'ACTIVE' || s.status === 'APPROVED' ? 'active'
    : s.status === 'SUSPENDED' ? 'past_due' : 'canceled';
  const next = s.billing_info?.next_billing_time ? Math.floor(Date.parse(s.billing_info.next_billing_time) / 1000) : null;
  await upsertSub(env, userId, 'paypal', id, status, next);
  return status;
}

app.post('/api/billing/paypal/activate', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'Sign in first.' }, 401);
  const { subscriptionID } = await c.req.json<any>().catch(() => ({}));
  if (!subscriptionID) return c.json({ error: 'Missing subscription.' }, 400);
  try { await syncPaypal(c.env, String(subscriptionID), u.id); return c.json({ ok: true }); }
  catch { return c.json({ error: 'We could not confirm your PayPal subscription. If you were charged, contact support.' }, 400); }
});

app.post('/api/webhooks/paypal', async (c) => {
  const raw = await c.req.text();
  const h = c.req.raw.headers;
  const verify = await fetch(ppBase(c.env) + '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await ppToken(c.env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: h.get('paypal-auth-algo'), cert_url: h.get('paypal-cert-url'),
      transmission_id: h.get('paypal-transmission-id'), transmission_sig: h.get('paypal-transmission-sig'),
      transmission_time: h.get('paypal-transmission-time'), webhook_id: c.env.PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(raw),
    }),
  });
  if (!verify.ok || ((await verify.json()) as any).verification_status !== 'SUCCESS') return c.text('Bad signature', 400);
  const ev = JSON.parse(raw);
  const subId = ev.resource?.billing_agreement_id || (String(ev.event_type).startsWith('BILLING.SUBSCRIPTION') ? ev.resource?.id : null);
  if (subId) { try { await syncPaypal(c.env, subId); } catch { /* ignore unknown subscriptions */ } }
  return c.text('ok');
});

app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));
export default app;
