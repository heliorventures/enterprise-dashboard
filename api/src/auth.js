const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const config = require('./config');
const bcrypt = require('bcryptjs');

const COOKIE = 'helior_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const failures = new Map();

function secret() {
  if (config.sessionSecret.length >= 32) return config.sessionSecret;
  if (config.production) throw new Error('DASHBOARD_SESSION_SECRET must contain at least 32 characters');
  return createHash('sha256').update(`helior:${config.dashboardUser}:${config.dashboardPassword}`).digest('hex');
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

function same(left, right) {
  const a = digest(left);
  const b = digest(right);
  return timingSafeEqual(a, b);
}

function cookieHeader(token, { clear = false } = {}) {
  const parts = [
    `${COOKIE}=${clear ? '' : token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
  ];
  if (clear) parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  else parts.push(`Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`);
  if (config.production) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== COOKIE) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

function sign(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
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
    if (!body?.u || !Number.isFinite(body.exp) || body.exp < Date.now()) return null;
    if (!same(body.u, config.dashboardUser)) return null;
    return { name: body.u };
  } catch {
    return null;
  }
}

function limited(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const row = failures.get(key) || { count: 0, from: now };
  if (now - row.from > 15 * 60 * 1000) {
    failures.set(key, { count: 0, from: now });
    return false;
  }
  return row.count >= 8;
}

function fail(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const row = failures.get(key);
  if (!row || now - row.from > 15 * 60 * 1000) failures.set(key, { count: 1, from: now });
  else row.count += 1;
}

function clearFailures(ip) {
  failures.delete(String(ip || 'unknown'));
}

function credentialsOk(username, password) {
  if (!same(username, config.dashboardUser)) return false;
  if (config.dashboardPasswordHash) {
    if (Buffer.byteLength(String(password), 'utf8') > 72) return false;
    return bcrypt.compare(String(password), config.dashboardPasswordHash);
  }
  if (!config.dashboardPassword) return false;
  return same(username, config.dashboardUser) && same(password, config.dashboardPassword);
}

function requireSession(req, res, next) {
  const user = verify(readCookie(req));
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  req.user = user;
  next();
}

async function login(req, res) {
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many sign-in attempts. Wait and try again.' });
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || username.length > 80 || !password || password.length > 200) {
    fail(req.ip);
    return res.status(400).json({ error: 'Enter a username and password' });
  }
  if (!await credentialsOk(username, password)) {
    fail(req.ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  clearFailures(req.ip);
  res.setHeader('Set-Cookie', cookieHeader(sign(config.dashboardUser)));
  res.json({ user: { name: config.dashboardUser } });
}

function validateConfiguration() {
  if (!config.production) return;
  if (config.dashboardPasswordHash) {
    if (!/^\$2[aby]\$(?:0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/.test(config.dashboardPasswordHash)) {
      throw new Error('DASHBOARD_PASSWORD_HASH must be a valid bcrypt hash; run configure-ui.ps1');
    }
  } else if (config.dashboardPassword.length < 8) {
    throw new Error('Configure dashboard login with configure-ui.ps1 or DASHBOARD_PASSWORD (at least 8 characters)');
  }
  secret();
}

function logout(_req, res) {
  res.setHeader('Set-Cookie', cookieHeader('', { clear: true }));
  res.json({ ok: true });
}

function session(req, res) {
  res.json({ user: req.user });
}

module.exports = {
  COOKIE,
  sign,
  verify,
  requireSession,
  login,
  logout,
  session,
  credentialsOk,
  validateConfiguration,
};
