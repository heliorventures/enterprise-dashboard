const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const config = require('./config');

const COOKIE = 'intel_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function secret() {
  if (config.sessionSecret.length >= 32) return config.sessionSecret;
  return createHash('sha256').update(`intel:${config.dashboardUser}:${config.dashboardPassword}`).digest('hex');
}

function same(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function cookieHeader(token, { clear = false } = {}) {
  const parts = [`${COOKIE}=${clear ? '' : token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (clear) parts.push('Max-Age=0');
  else parts.push(`Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`);
  return parts.join('; ');
}

function sign(user) {
  const payload = Buffer.from(JSON.stringify({ u: user.username, r: user.role, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!same(sig, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!body?.u || body.exp < Date.now()) return null;
    return { username: body.u, role: body.r || 'VIEWER' };
  } catch {
    return null;
  }
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== COOKIE) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

function requireSession(req, res, next) {
  const user = verify(readCookie(req));
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  req.user = user;
  next();
}

function login(req, res) {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!same(username, config.dashboardUser) || !same(password, config.dashboardPassword)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const user = { username: config.dashboardUser, role: 'SUPER_ADMIN' };
  res.setHeader('Set-Cookie', cookieHeader(sign(user)));
  res.json({ user });
}

function logout(_req, res) {
  res.setHeader('Set-Cookie', cookieHeader('', { clear: true }));
  res.json({ ok: true });
}

function session(req, res) {
  res.json({ user: req.user });
}

function canSeeAll(user) {
  return ['SUPER_ADMIN', 'CEO', 'VP', 'AUDITOR'].includes(user?.role);
}

module.exports = { requireSession, login, logout, session, canSeeAll, COOKIE };
