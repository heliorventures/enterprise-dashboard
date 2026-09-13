const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const dashboardService = require('./dashboardService');
const books = require('./books');
const { timingSafeEqual, createHash } = require('node:crypto');
const { ingestSnapshot } = require('./ingest');
const { registerTallyRoutes } = require('./tallyRoutes');
const reports = require('./reports');
const auth = require('./auth');

const app = express();

app.use(cors({ origin: ['http://localhost:4200'], credentials: true }));
app.disable('x-powered-by');
function authenticateSender(req, res, next) {
  const supplied = req.headers.authorization || '';
  const expected = 'Bearer ' + config.ingestToken;
  const hash = value => createHash('sha256').update(value).digest();
  if (config.ingestToken.length < 32 || !timingSafeEqual(hash(supplied), hash(expected))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
const staged = require('./ingestChunks');
const sourceArchive = require('./sourceArchive');
const sourceUnpack = require('./sourceUnpack');
const sourceSync = require('./sourceSync');
async function completeSource(body) {
  const result = await sourceArchive.complete(body);
  if (result.ok && !result.duplicate && result.coverageStatus === 'complete') {
    try { result.unpack = await sourceSync.recordBatch(result.batchId); }
    catch (error) { result.unpack = { ok: false, error: error.message }; }
  }
  return result;
}
for (const operation of ['begin','chunk','complete']) {
  app.post('/api/ingest/tally/source/' + operation, authenticateSender, express.json({limit:'5mb'}), async (req,res) => {
    try { res.json(operation === 'complete' ? await completeSource(req.body) : await sourceArchive[operation](req.body)); }
    catch(error) {
      const status=error.status || (error.code==='23505' ? 409 : 500);
      if(status===500) console.error('Source archive failed:',error.code || error.name);
      res.status(status).json({error:status===500?'Source archive failed; retry the same batch':error.code==='23505'?'Duplicate source record identity':error.message});
    }
  });
}
app.post('/api/process/tally/unpack', authenticateSender, express.json(), async (req, res) => {
  try {
    const options = { force: req.body?.force === true };
    res.json(req.body?.batchId ? await sourceUnpack.unpackBatch(req.body.batchId, options) : await sourceUnpack.unpackLatest(options));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Source unpack failed' });
  }
});
for (const operation of ['begin', 'chunk', 'complete']) {
  app.post('/api/ingest/tally/' + operation, authenticateSender, express.json({ limit: '1100kb' }), async (req, res) => {
    try { res.json(await staged[operation](req.body)); }
    catch (error) {
      const status = error.status || (error.code === '23505' ? 409 : 500);
      if (status === 500) console.error('Staged ingestion failed:', error.code || error.name);
      res.status(status).json({ error: status === 500 ? 'Upload operation failed; retry the same request' : error.code === '23505' ? 'Company identity conflict' : error.message });
    }
  });
}
app.post('/api/ingest/tally', authenticateSender, express.json({ limit: '20mb' }), async (req, res) => {
  try { res.json(await ingestSnapshot(req.body)); }
  catch (error) {
    const status = error.status || (error.code === '23505' ? 409 : 500);
    if (status === 500) console.error('Tally ingestion failed:', error.code || error.name);
    res.status(status).json({ error: status === 500 ? 'Snapshot could not be saved; retry with the same batchId' : error.code === '23505' ? 'Company identity conflicts with an existing company' : error.message });
  }
});
app.use(express.json());
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/session', auth.requireSession, auth.session);
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login' || req.path === '/auth/logout' || req.path === '/auth/session') {
    return next();
  }
  if (req.path.startsWith('/ingest/tally') || req.path === '/process/tally/unpack') {
    return next();
  }
  return auth.requireSession(req, res, next);
});

app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1 FROM schema_migrations LIMIT 1');
    res.json({ ok: true, service: 'api', database: 'connected' });
  } catch (error) {
    res.status(503).json({ ok: false, service: 'api', database: 'unavailable' });
  }
});

app.get('/api/companies', async (_req, res) => {
  try {
    const companies = await dashboardService.getCompanies();
    res.json(companies.map((row) => ({ id: String(row.CompanyID), name: row.CompanyName })));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete request' });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const company = String(req.query.company || 'all');
    const dashboard = await dashboardService.getDashboard(company);
    res.json(dashboard);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete request' });
  }
});

app.get('/api/ledgers', async (req, res) => {
  try {
    const result = await books.listLedgers({
      company: req.query.company,
      q: req.query.q,
      group: req.query.group,
      page: req.query.page,
      pageSize: req.query.pageSize || 25,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete request' });
  }
});

app.get('/api/reports/expenses', async (req, res) => {
  try {
    res.json(await reports.expenseReport({ company: req.query.company }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete request' });
  }
});

app.get('/api/reports/projects', async (req, res) => {
  try {
    res.json(await reports.projectReport({ company: req.query.company }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete request' });
  }
});

app.get('/api/vouchers', async (req, res) => {
  try {
    const result = await books.listVouchers({
      company: req.query.company,
      q: req.query.q,
      type: req.query.type,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      pageSize: req.query.pageSize || 25,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to complete request' });
  }
});

if (config.tallyMode === 'pull' && !config.production) registerTallyRoutes(app);
app.get('/api/tally/sync', async (_req, res) => {
  try { res.json(await sourceSync.history()); }
  catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to load Tally sync history' }); }
});
app.post('/api/tally/sync', async (req, res) => {
  try { res.json(await sourceSync.start({ triggeredBy: req.user?.name || 'dashboard', force: req.body?.force === true })); }
  catch (error) {
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Tally sync failed',
      run: error.run,
    });
  }
});
if (!(config.tallyMode === 'pull' && !config.production)) {
  app.get('/api/tally/status', async (_req, res) => {
    try {
      const snapshot = await sourceSync.history({ limit: 1 });
      const latest = snapshot.current || snapshot.runs[0] || null;
      res.json({
        connected: Boolean(latest),
        mode: 'archive',
        url: '',
        companies: [],
        message: latest?.message || 'Books are updated from dumped Tally source records',
        current: snapshot.current,
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Unable to load Tally status' });
    }
  });
}
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type === 'entity.too.large' ? 'Request exceeds the endpoint size limit' : 'Invalid request' }));

async function start() {
  if (config.production && config.ingestToken.length < 32) throw new Error('TALLY_INGEST_TOKEN must contain at least 32 characters');
  if (config.production && config.dashboardPassword.length < 8) {
    throw new Error('DASHBOARD_PASSWORD must contain at least 8 characters');
  }
  await db.query('SELECT version FROM schema_migrations LIMIT 1');
  const server = app.listen(config.port, config.host, () => console.log('API listening on port ' + config.port));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(() => db.close().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  });
  return server;
}
if (require.main === module) start().catch(error => {
  console.error('Failed to start API:', error.message);
  db.close().finally(() => { process.exitCode = 1; });
});
module.exports = { app, start };
