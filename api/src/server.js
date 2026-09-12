const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const dashboardService = require('./dashboardService');
const books = require('./books');
const { timingSafeEqual, createHash } = require('node:crypto');
const { ingestSnapshot } = require('./ingest');
const { registerTallyRoutes } = require('./tallyRoutes');

const app = express();

app.use(cors({ origin: ['http://localhost:4200'] }));
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
for (const operation of ['begin','chunk','complete']) {
  app.post('/api/ingest/tally/source/' + operation, authenticateSender, express.json({limit:'5mb'}), async (req,res) => {
    try { res.json(await sourceArchive[operation](req.body)); }
    catch(error) {
      const status=error.status || (error.code==='23505' ? 409 : 500);
      if(status===500) console.error('Source archive failed:',error.code || error.name);
      res.status(status).json({error:status===500?'Source archive failed; retry the same batch':error.code==='23505'?'Duplicate source record identity':error.message});
    }
  });
}
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
else app.get('/api/tally/status', (_req, res) => res.json({ connected: true, mode: 'push', url: '', companies: [], message: 'Receiving snapshots from the Tally sender service' }));
app.post('/api/tally/sync', (_req, res) => res.status(405).json({ error: 'Synchronization is initiated by the Tally sender service' }));
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type === 'entity.too.large' ? 'Request exceeds the endpoint size limit' : 'Invalid request' }));

async function start() {
  if (config.production && config.ingestToken.length < 32) throw new Error('TALLY_INGEST_TOKEN must contain at least 32 characters');
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
