const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DASHBOARD_USER = 'admin';
process.env.DASHBOARD_PASSWORD = 'secret-pass';
process.env.DASHBOARD_SESSION_SECRET = 'test-session-secret-at-least-32-chars!!';

const config = require('../src/config');
const auth = require('../src/auth');

test('signed sessions verify for the configured user and expire', () => {
  const token = auth.sign(config.dashboardUser);
  assert.equal(auth.verify(token).name, config.dashboardUser);
  assert.equal(auth.verify('not-a-token'), null);
  assert.equal(auth.verify(token.replace(/\./, '.x')), null);
  assert.equal(auth.credentialsOk(config.dashboardUser, config.dashboardPassword), true);
  assert.equal(auth.credentialsOk(config.dashboardUser, 'wrong'), false);
  assert.equal(auth.credentialsOk('other', config.dashboardPassword), false);
});
