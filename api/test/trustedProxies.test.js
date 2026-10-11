const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createTrustedProxies } = require('../src/trustedProxies');

test('only configured Docker proxies can forward client identity across two hops', async () => {
  let clock = 1;
  let broken = false;
  const proxies = createTrustedProxies(['ui', 'edge'], async host => {
    if (broken) throw new Error('DNS unavailable');
    return [{ address: host === 'ui' ? '172.20.0.3' : '172.20.0.2' }];
  }, () => clock);
  await proxies.middleware({}, {}, error => { if (error) throw error; });
  const app = express();
  app.set('trust proxy', proxies.trust);
  function client(peer, forwarded) {
    const req = Object.create(app.request);
    req.app = app;
    req.socket = { remoteAddress: peer };
    req.headers = { 'x-forwarded-for': forwarded };
    return req.ip;
  }
  assert.equal(client('::ffff:172.20.0.3', '198.51.100.1, 172.20.0.2'), '198.51.100.1');
  assert.equal(client('172.20.0.3', '203.0.113.2, 172.20.0.2'), '203.0.113.2');
  assert.equal(client('172.20.0.9', '198.51.100.1'), '172.20.0.9');
  assert.equal(client('172.20.0.3', '198.51.100.1, 172.20.0.9'), '172.20.0.9');
  broken = true;
  clock += 30001;
  await proxies.middleware({}, {}, error => { if (error) throw error; });
  assert.equal(client('172.20.0.3', '198.51.100.1, 172.20.0.2'), '172.20.0.3');
});

test('one forwarded client cannot lock another client out', async () => {
  const config = require('../src/config');
  const auth = require('../src/auth');
  const previous = { dashboardPassword: config.dashboardPassword, dashboardPasswordHash: config.dashboardPasswordHash };
  config.dashboardPassword = 'test-login-pass';
  config.dashboardPasswordHash = '';
  function response() {
    return { code: 200, status(code) { this.code = code; return this; }, json() {}, setHeader() {} };
  }
  try {
    for (let i = 0; i < 8; i++) {
      const res = response();
      await auth.login({ ip: '198.51.100.101', body: { username: config.dashboardUser, password: 'wrong' } }, res);
      assert.equal(res.code, 401);
    }
    const blocked = response();
    await auth.login({ ip: '198.51.100.101', body: { username: config.dashboardUser, password: 'test-login-pass' } }, blocked);
    assert.equal(blocked.code, 429);
    const other = response();
    await auth.login({ ip: '203.0.113.102', body: { username: config.dashboardUser, password: 'test-login-pass' } }, other);
    assert.equal(other.code, 200);
  } finally { Object.assign(config, previous); }
});
