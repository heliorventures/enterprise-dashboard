const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.TALLY_INGEST_TOKEN = 'route-test-ingest-token-with-32-characters';
process.env.DASHBOARD_USER = 'retained-api-user';
process.env.DASHBOARD_PASSWORD = 'retained-api-password';
process.env.DASHBOARD_SESSION_SECRET = 'retained-api-session-secret-at-least-32-chars';
const { app } = require('../src/server');
const db = require('../src/db');
const dashboard = require('../src/intelligence/dashboard/service');
const imports = require('../src/intelligence/imports/service');
const audit = require('../src/intelligence/audit');
let server, origin, cookie;
const id = '11111111-1111-4111-8111-111111111111';

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.DASHBOARD_USER, password: process.env.DASHBOARD_PASSWORD }),
  });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
});

function request(path, options = {}) {
  return fetch(`${origin}/api/imports${path}`, { ...options, headers: { Cookie: cookie, ...options.headers } });
}
async function stub(object, key, implementation, run) {
  const original = object[key];
  const snapshot = object === db && key === 'query' ? db.readSnapshot : null;
  // SQL-contract tests replace the database. Do not open a real connection for
  // their read transaction; isolated PostgreSQL tests cover snapshot behavior.
  if (snapshot) db.readSnapshot = async work => work();
  object[key] = implementation;
  try { return await run(); } finally {
    object[key] = original;
    if (snapshot) db.readSnapshot = snapshot;
  }
}

test('all retained reads and exception decisions remain protected by the real session guard', async () => {
  for (const path of ['/quality', '/audit', '/exceptions', `/accounts/${id}`, '/reports/outstanding.csv', '/reports/reconciliation.csv', '/reports/exceptions.csv', '/reports/quality.csv']) {
    assert.equal((await fetch(`${origin}/api/imports${path}`)).status, 401, path);
  }
  const response = await fetch(`${origin}/api/imports/exceptions/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 401);
});

test('quality and audit use static routes and retain their service payloads', async () => {
  await stub(dashboard, 'dataQuality', async scope => {
    assert.deepEqual(scope, { companyId: null });
    return { accounts: 8, issues: [{ type: 'MISSING_IN_TALLY', count: 2 }] };
  }, async () => {
    const response = await request('/quality?company=all');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accounts: 8, issues: [{ type: 'MISSING_IN_TALLY', count: 2 }] });
  });
  await stub(audit, 'list', async scope => {
    assert.deepEqual(scope, { entity: 'exception', limit: 25 });
    return [{ id: 2, entity: 'exception' }];
  }, async () => {
    const response = await request('/audit?entity=exception&limit=25');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: 2, entity: 'exception' }]);
  });
});

test('exception decisions validate permitted fields and record the authenticated actor', async () => {
  let calls = 0;
  await stub(dashboard, 'updateException', async (exceptionId, decision, actor) => {
    calls++;
    assert.equal(exceptionId, id);
    assert.deepEqual(decision, { status: 'RESOLVED', comment: 'Confirmed with finance' });
    assert.equal(actor, process.env.DASHBOARD_USER);
    return { id, status: decision.status };
  }, async () => {
    for (const [exceptionId, body] of [
      ['bad-id', { status: 'RESOLVED' }], [id, { status: 'OPEN' }], [id, { status: 'RESOLVED', owner: 'other' }],
      [id, { status: 'RESOLVED', comment: 'x'.repeat(2001) }], [id, { status: 'RESOLVED', comment: {} }], [id, null],
    ]) {
      const response = await request(`/exceptions/${exceptionId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    const response = await request(`/exceptions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED', comment: 'Confirmed with finance' }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  });
});

test('exception queue returns real paging metadata beyond 500 records', async () => {
  const result = { items: [{ id, title: 'Exception 501' }], total: 601, page: 3, pageSize: 200 };
  await stub(dashboard, 'listExceptionsPage', async scope => {
    assert.deepEqual(scope, { companyId: null, status: 'OPEN', q: 'Unmatched', page: 3, pageSize: 200 });
    return result;
  }, async () => {
    await stub(dashboard, 'listExceptions', async () => [], async () => {
      const response = await request('/exceptions?company=all&status=OPEN&q=Unmatched&page=3&pageSize=200');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), result);
    });
  });
});

test('malformed identities, scalar filters and paging fail safely before service/database calls', async () => {
  await stub(db, 'query', async () => { assert.fail('invalid filters must not query the database'); }, async () => {
    for (const path of [
      '/quality?company=abc', '/quality?company=1&company=2', '/quality?company=2147483648',
      '/outstanding?page=1.5', '/outstanding?page=-1', '/outstanding?pageSize=501', '/outstanding?page=',
      '/outstanding?q=a&q=b', `/outstanding?q=${'x'.repeat(201)}`, '/outstanding?status=arbitrary',
      '/exceptions?status=arbitrary', '/audit?limit=-1', '/audit?limit=501', '/audit?entity[]=exception',
      '/accounts/not-a-uuid', '/sync/not-a-uuid', '/not-a-uuid/preview', '/not-a-uuid/progress', '/not-a-uuid',
      '/sync?mapped=invalid', '/sync?minDifference=NaN', '/sync?minDifference=-1',
    ]) {
      const response = await request(path);
      assert.equal(response.status, 400, path);
      assert.ok((await response.json()).error, path);
    }
  });
});

test('import paging accepts every size offered by the shared Angular pager', async () => {
  await stub(dashboard, 'outstanding', async scope => {
    assert.ok([250, 500].includes(scope.pageSize));
    return { items: [], total: 0, page: scope.page, pageSize: scope.pageSize };
  }, async () => {
    for (const pageSize of [250, 500]) {
      const response = await request(`/outstanding?company=all&pageSize=${pageSize}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).pageSize, pageSize);
    }
  });
});

test('Tally sync page size, offset and metadata expose all 1000 records', async () => {
  await stub(db, 'query', async (sql, params = []) => {
    if (sql.includes('GROUP BY r.status')) return { rows: [{ status: 'MATCHED', count: 1000 }] };
    if (sql.includes('count(*)')) return { rows: [{ count: 1000 }] };
    const [limit, offset] = params.slice(-2);
    return { rows: Array.from({ length: Math.min(limit, 1000 - offset) }, (_, i) => ({ id: `row-${offset + i + 1}`, status: 'MATCHED' })) };
  }, async () => {
    const response = await request('/sync?company=all&page=2&pageSize=500');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.total, 1000);
    assert.equal(data.page, 2);
    assert.equal(data.pageSize, 500);
    assert.equal(data.items.length, 500);
    assert.equal(data.items[0].id, 'row-501');
    assert.equal(data.items.at(-1).id, 'row-1000');
  });
});

test('CSV exports fetch the full scoped report independently of visible paging and escape cells', async () => {
  await stub(db, 'query', async (_sql, params) => { assert.deepEqual(params, [7]); return { rows: [{ id }] }; }, async () => {
    await stub(dashboard, 'outstanding', async scope => {
      assert.deepEqual(scope, { companyId: id, status: 'AMOUNT_MISMATCH', q: 'Acme', page: 1, pageSize: 10001 });
      return { items: [
        { account_name: '=HYPERLINK("malicious")', note: 'a,b\n"c"', amount: -42.5 },
        { account_name: ' \t+SUM(1,2)', note: '\tunsafe', amount: '12.00', extra: '@evil' },
      ], total: 2 };
    }, async () => {
      const response = await request('/reports/outstanding.csv?company=7&status=AMOUNT_MISMATCH&q=Acme&page=3&pageSize=1');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/csv/);
      assert.equal(response.headers.get('content-disposition'), 'attachment; filename="outstanding.csv"');
      const csv = await response.text();
      assert.equal(csv, 'account_name,note,amount,extra\r\n"\'=HYPERLINK(""malicious"")","a,b\n""c""",-42.5,\r\n"\' \t+SUM(1,2)",\'\tunsafe,12.00,\'@evil\r\n');
    });
  });
});

test('every CSV report uses complete capped scope and rejects overflow without truncation', async () => {
  for (const [type, method, result] of [
    ['reconciliation', 'gaps', [{ id, status: 'AMOUNT_MISMATCH' }]],
    ['exceptions', 'listExceptions', [{ id, status: 'RESOLVED' }]],
    ['quality', 'dataQuality', { accounts: 3, issues: [{ type: 'MISSING', count: 1 }] }],
  ]) {
    await stub(dashboard, method, async scope => {
      assert.equal(scope.companyId, null);
      if (type !== 'quality') { assert.equal(scope.limit, 10001); assert.equal(scope.q, 'Acme'); }
      if (type === 'exceptions') assert.equal(scope.status, 'RESOLVED');
      return result;
    }, async () => {
      const response = await request(`/reports/${type}.csv?company=all&q=Acme${type === 'exceptions' ? '&status=RESOLVED' : ''}`);
      assert.equal(response.status, 200, type);
      assert.match(await response.text(), type === 'quality' ? /accounts,issues/ : /id,status/);
    });
  }
  await stub(dashboard, 'outstanding', async () => ({ items: [{ id }], total: 10001 }), async () => {
    const response = await request('/reports/outstanding.csv');
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /10,000/);
  });
  for (const [type, method] of [['reconciliation', 'gaps'], ['exceptions', 'listExceptions']]) {
    await stub(dashboard, method, async () => Array.from({ length: 10001 }, () => ({ id })), async () => {
      assert.equal((await request(`/reports/${type}.csv`)).status, 413);
    });
  }
  await stub(dashboard, 'outstanding', async () => ({ items: [{ id }], total: 2 }), async () => {
    assert.equal((await request('/reports/outstanding.csv')).status, 409);
  });
  assert.equal((await request('/reports/unrecognized.csv')).status, 404);
});

test('CSV preserves exact negative decimal financial strings and escapes formula-like text', async () => {
  await stub(dashboard, 'outstanding', async () => ({ items: [{
    account_name: '-123.45', bill_amount: '-1234567890123456.78',
    difference: '-42.50', note: '-42.50', paid_amount: '=SUM(1,2)',
  }], total: 1 }), async () => {
    const response = await request('/reports/outstanding.csv');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'account_name,bill_amount,difference,note,paid_amount\r\n\'-123.45,-1234567890123456.78,-42.50,\'-42.50,"\'=SUM(1,2)"\r\n');
  });
});

test('CSV HTTP exports reach current financial views with a bound complete-report limit and search', async () => {
  for (const [type, view, status] of [
    ['outstanding', 'intel_current_outstanding', 'AMOUNT_MISMATCH'],
    ['reconciliation', 'intel_current_reconciliations', 'AMOUNT_MISMATCH'],
    ['exceptions', 'intel_current_exceptions', 'RESOLVED'],
  ]) {
    const queries = [];
    await stub(db, 'query', async (sql, params = []) => {
      queries.push({ sql, params });
      if (/SELECT id FROM intel_companies/.test(sql)) return { rows: [{ id }], rowCount: 1 };
      if (/count\(\*\)/i.test(sql) && !/OVER\s*\(/i.test(sql)) return { rows: [{ count: 1 }], rowCount: 1 };
      return { rows: [{ id, status, total: 1, total_count: 1 }], rowCount: 1 };
    }, async () => {
      const response = await request(`/reports/${type}.csv?company=7&status=${status}&q=Acme`);
      assert.equal(response.status, 200, type);
      const financial = queries.find(query => query.sql.includes(view) && query.params.includes(10001));
      assert.ok(financial, `${type} must use ${view} and bind 10001 rather than inherit a display cap`);
      assert.ok(financial.params.includes(id), `${type} must bind the selected company`);
      assert.ok(financial.params.includes(status), `${type} must bind the status filter`);
      if (type === 'outstanding') {
        const statusParameter = financial.params.indexOf(status) + 1;
        assert.ok(financial.sql.includes(`r.status=$${statusParameter}`), 'outstanding status must reference its bound SQL parameter');
      }
      assert.ok(financial.params.includes('%Acme%'), `${type} must bind the search filter`);
      assert.match(financial.sql, /ILIKE/i);
      assert.match(financial.sql, /LIMIT\s+\$\d+/i);
    });
  }
});

test('database and unexpected service failures never disclose server internals', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await stub(dashboard, 'accountDetail', async () => { throw Object.assign(new Error('secret postgres relation and credentials'), { code: '42P01' }); }, async () => {
      const response = await request(`/accounts/${id}`);
      assert.equal(response.status, 500);
      assert.doesNotMatch(JSON.stringify(await response.json()), /postgres|credentials|42P01/);
    });
    await stub(imports, 'getResults', async () => { throw Object.assign(new Error('Import not found'), { status: 404 }); }, async () => {
      const response = await request(`/${id}`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'Import not found' });
    });
  } finally { console.error = originalError; }
});

test('malformed multipart uploads return safe JSON client errors', async () => {
  const form = new FormData();
  form.append('unexpected', new Blob(['untrusted upload']), 'unexpected.xlsx');
  const response = await request('/upload', { method: 'POST', body: form });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { error: 'Invalid uploaded file' });
});

test('uploads require an explicit company before reaching import storage or database work', async () => {
  await stub(imports, 'upload', async () => { assert.fail('invalid upload must not reach the import service'); }, async () => {
    for (const company of [undefined, 'all', 'invalid', '2147483648']) {
      const form = new FormData();
      form.append('file', new Blob(['workbook']), 'outstanding.xlsx');
      if (company !== undefined) form.append('companyId', company);
      assert.equal((await request('/upload', { method: 'POST', body: form })).status, 400, String(company));
    }
  });
});

test('mapping changes require explicit targets and preserve deliberate null ignores', async () => {
  let calls = 0;
  await stub(imports, 'updateMapping', async (_id, mappings) => { calls++; return { mappings }; }, async () => {
    for (const mappings of [
      [{ sourceHeader: 'Account' }], [{ sourceHeader: 'Account', targetField: '' }],
      [{ sourceHeader: ' ', targetField: null }], [{ sourceHeader: 'Account', targetField: {} }],
    ]) {
      const response = await request(`/${id}/mapping`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mappings }),
      });
      assert.equal(response.status, 400);
    }
    const mappings = [{ sourceHeader: 'Account', targetField: 'account_name' }, { sourceHeader: 'Ignore', targetField: null }];
    const response = await request(`/${id}/mapping`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mappings }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { mappings });
    assert.equal(calls, 1);
  });
});
