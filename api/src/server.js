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
  req.senderAuthenticated=true;
  next();
}
const staged = require('./ingestChunks');
const sourceArchive = require('./sourceArchive');
const sourceUnpack = require('./sourceUnpack');
const sourceSync = require('./sourceSync');
const sourceDiagnostics = require('./sourceDiagnostics');
app.post('/api/ingest/tally/diagnostics',authenticateSender,express.json({limit:'512kb'}),async(req,res)=>{
  try {res.json(await sourceDiagnostics.save(req.body));}
  catch(error){res.status(error.status||503).json({error:error.status?error.message:'Diagnostics could not be saved; retain and retry the same events'});}
});
async function completeSource(body,mode='full') {
  const result = await sourceArchive.complete(body,mode);
  // Archive acknowledgement is independent of downstream reporting validation.
  if (result.ok && (result.coverageStatus === 'complete'||result.reportingBatchId)) {
    try { result.unpack = await sourceSync.recordBatch(result.reportingBatchId||result.batchId); }
    catch (error) {
      let diagnosticId=null;
      try {diagnosticId=await sourceDiagnostics.recordApiFailure(error,{operation:'reporting',body:{batchId:result.reportingBatchId||result.batchId}});}
      catch(diagnosticError){console.error('Reporting diagnostic persistence failed:',diagnosticError.code||diagnosticError.name);}
      result.unpack = { ok: false, error: error.status?error.message:'Reporting publication failed; review saved diagnostics',diagnosticId };
    }
  }
  result.reportingStatus = result.coverageStatus !== 'complete'&&!result.reportingBatchId ? 'blocked' : result.unpack?.ok === true ? 'validated' : 'error';
  return result;
}
for(const replacement of [false,true])app.post('/api/ingest/tally/'+(replacement?'source-period-replace':'source-period')+'/preflight',authenticateSender,express.json({limit:'10kb'}),async(req,res)=>{
  try {
    if(typeof req.body?.companyExternalId!=='string'||!req.body.companyExternalId||req.body.companyExternalId.length>200)throw Object.assign(new Error('Company identity required'),{status:400});
    const baseline=await require('./sourcePeriod').baseline(db,req.body.companyExternalId,undefined,replacement);
    res.json({ok:true,companyExternalId:req.body.companyExternalId,baselineBatchId:baseline?.batch_id||null,...(replacement?{periodMode:'replace'}:{})});
  } catch(error){
    let diagnosticId=null;
    try {diagnosticId=await sourceDiagnostics.recordApiFailure(error,{operation:replacement?'period-replace/preflight':'period/preflight',body:req.body});}
    catch(diagnosticError){console.error('Preflight diagnostic persistence failed:',diagnosticError.code||diagnosticError.name);}
    res.status(error.status||500).json({error:error.status?error.message:'Unable to verify full sync baseline',diagnosticId});}
});
for (const mode of ['full','period','period-replace']) for (const operation of ['begin','chunk','complete']) {
  app.post('/api/ingest/tally/'+(mode==='full'?'source/':mode==='period'?'source-period/':'source-period-replace/') + operation, authenticateSender, express.json({limit:'5mb'}), async (req,res) => {
    try { res.json(operation === 'complete' ? await completeSource(req.body,mode) : await sourceArchive[operation](req.body,mode)); }
    catch(error) {
      const status=error.status || (error.code==='23505' ? 409 : 500);
      let diagnosticId=null;
      try {diagnosticId=await sourceDiagnostics.recordApiFailure(error,{operation:mode+'/'+operation,body:req.body});}
      catch(diagnosticError){console.error('Source diagnostic persistence failed:',diagnosticError.code||diagnosticError.name);}
      if(status===500) console.error('Source archive failed:',error.code || error.name);
      res.status(status).json({error:status===500?'Source archive failed; retry the same batch':error.code==='23505'?'Duplicate source record identity':error.message,diagnosticId,...(error.code==='PERIOD_CAPTURE_STALE'?{code:error.code}:{})});
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

// These routes are behind the same authenticated API middleware as the books.
const sourceReports = require('./sourceReports');
for (const [path, handler] of [
  ['/api/reports/source', sourceReports.overview],
  ['/api/reports/source/masters', sourceReports.masterRows],
  ['/api/reports/source/details', sourceReports.details],
  ['/api/tally/archives', sourceReports.archives],
  ['/api/tally/diagnostics', sourceDiagnostics.list],
  ['/api/tally/issues', sourceReports.issues],
  ['/api/tally/source-record', sourceReports.record],
]) app.get(path, async (req,res) => {
  try { res.json(await handler(req.query)); }
  catch (error) { res.status(error.status || 500).json({error:error.status ? error.message : 'Unable to load source reporting data'}); }
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
app.use(async(error, req, res, _next) => {
  const message=error.type==='entity.too.large'?'Request exceeds the endpoint size limit':'Invalid request';
  let diagnosticId=null;
  if(req.senderAuthenticated&&!req.path.endsWith('/diagnostics'))try {
    diagnosticId=await sourceDiagnostics.recordApiFailure(Object.assign(new Error(message),{status:error.status||400,code:error.type==='entity.too.large'?'REQUEST_TOO_LARGE':'INVALID_REQUEST'}),
      {operation:'request/'+req.path.split('/').at(-1),body:{}});
  }catch(diagnosticError){console.error('Request diagnostic persistence failed:',diagnosticError.code||diagnosticError.name);}
  res.status(error.status||500).json({error:message,diagnosticId});
});

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
