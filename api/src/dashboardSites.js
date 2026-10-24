const db = require('./db');

function hostname(authority) {
  const invalid = () => Object.assign(new Error('Invalid website hostname'), { status: 400 });
  if (typeof authority !== 'string' || authority.length > 260) throw invalid();
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(authority);
  if (!match || (match[2] && (+match[2] < 1 || +match[2] > 65535))) throw invalid();
  const host = match[1].toLowerCase().replace(/\.$/, '');
  if (host.length > 253 || !host.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw invalid();
  return host;
}

async function middleware(req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    // Both Caddy hops preserve Host. Never select a site from forwarded headers,
    // a query parameter, a cookie, or a browser-supplied company list.
    const site = await db.siteForHost(hostname(req.headers.host));
    if (!site) return res.status(404).json({ error: 'Website is not configured or is disabled' });
    req.dashboardSite = site;
    db.withSite(site, next);
  } catch (error) {
    res.status(error.status === 400 ? 400 : 503).json({
      error: error.status === 400 ? error.message : 'Website configuration is temporarily unavailable',
    });
  }
}

module.exports = { hostname, middleware };
