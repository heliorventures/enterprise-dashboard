const { lookup } = require('node:dns').promises;
const { isIP } = require('node:net');

const normalize = address => String(address).replace(/^::ffff:/i, '');

// Resolve only administrator-configured proxy names. Docker addresses can change
// on recreation; resolving lazily avoids an API/UI startup dependency cycle.
function createTrustedProxies(hosts = [], resolve = lookup, now = Date.now) {
  let addresses = new Set();
  let expires = 0;
  let pending;
  async function refresh() {
    if (now() < expires) return;
    if (!pending) pending = Promise.all(hosts.map(async host => {
      try { return await resolve(host, { all: true }); }
      catch { return []; } // Failed DNS must never widen trust.
    })).then(results => {
      addresses = new Set(results.flat().map(row => normalize(row.address)).filter(isIP));
      expires = now() + 30000;
    }).finally(() => { pending = undefined; });
    await pending;
  }
  return {
    trust: address => addresses.has(normalize(address)),
    middleware: async (_req, _res, next) => {
      try { await refresh(); next(); } catch (error) { next(error); }
    },
  };
}

module.exports = { createTrustedProxies };
