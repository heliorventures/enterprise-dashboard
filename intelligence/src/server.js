const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const imports = require('./imports/service');
const dashboard = require('./dashboard/service');
const audit = require('./audit');
const tally = require('./tally/provider');

fs.mkdirSync(path.join(config.storageDir, 'imports'), { recursive: true });
fs.mkdirSync(path.join(config.storageDir, 'documents'), { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3010'], credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1 FROM intel_schema_migrations LIMIT 1');
    res.json({ ok: true, service: 'intelligence' });
  } catch {
    res.status(503).json({ ok: false, service: 'intelligence' });
  }
});

app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/session', auth.requireSession, auth.session);
app.use('/api', auth.requireSession);

app.get('/api/companies', async (_req, res) => {
  res.json(await dashboard.companies());
});
app.get('/api/sources', async (_req, res) => {
  res.json(await dashboard.sources());
});
app.get('/api/tally/companies', async (_req, res) => {
  res.json(await tally.listCompanies());
});
app.get('/api/fields', async (_req, res) => {
  const result = await db.query('SELECT * FROM intel_field_catalog ORDER BY group_name, field_key');
  res.json(result.rows);
});

app.post('/api/imports/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Excel file required' });
  const result = await imports.upload({
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    companyId: req.body.companyId || null,
    uploadedBy: req.user.username,
  });
  res.json(result);
});
app.get('/api/imports', async (_req, res) => res.json(await imports.listImports()));
app.get('/api/imports/:id', async (req, res) => res.json(await imports.getResults(req.params.id)));
app.get('/api/imports/:id/preview', async (req, res) => res.json(await imports.preview(req.params.id)));
app.post('/api/imports/:id/validate', async (req, res) => res.json(await imports.validateOnly(req.params.id)));
app.post('/api/imports/:id/process', async (req, res) => res.json(await imports.processFile(req.params.id, { username: req.user.username })));
app.post('/api/imports/:id/reprocess', async (req, res) => res.json(await imports.processFile(req.params.id, { username: req.user.username, reprocess: true })));
app.get('/api/imports/:id/errors', async (req, res) => res.json(await imports.rowErrors(req.params.id)));
app.put('/api/imports/:id/mapping', async (req, res) => res.json(await imports.updateMapping(req.params.id, req.body.mappings || [], req.user.username)));

app.get('/api/dashboard/summary', async (req, res) => res.json(await dashboard.summary({ companyId: req.query.companyId })));
app.get('/api/dashboard/company/:companyId', async (req, res) => res.json(await dashboard.summary({ companyId: req.params.companyId })));
app.get('/api/outstanding', async (req, res) => res.json(await dashboard.outstanding(req.query)));
app.get('/api/ageing', async (req, res) => res.json(await dashboard.ageing(req.query)));
app.get('/api/reconciliation', async (req, res) => res.json(await dashboard.gaps(req.query)));
app.get('/api/gaps', async (req, res) => res.json(await dashboard.gaps(req.query)));
app.get('/api/quality', async (req, res) => res.json(await dashboard.dataQuality(req.query)));
app.get('/api/accounts/:id', async (req, res) => res.json(await dashboard.accountDetail(req.params.id)));
app.get('/api/exceptions', async (req, res) => res.json(await dashboard.listExceptions(req.query)));
app.get('/api/work-queue', async (req, res) => res.json(await dashboard.listExceptions({ ...req.query, status: req.query.status || 'OPEN' })));
app.put('/api/exceptions/:id', async (req, res) => res.json(await dashboard.updateException(req.params.id, req.body, req.user.username)));
app.get('/api/audit', async (req, res) => res.json(await audit.list(req.query)));

app.post('/api/documents', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const stored = path.join(config.storageDir, 'documents', `${Date.now()}-${req.file.originalname.replace(/[^\w.\-]+/g, '_')}`);
  fs.writeFileSync(stored, req.file.buffer);
  const result = await db.query(
    `INSERT INTO intel_documents (company_id, exception_id, outstanding_id, document_type, file_name, stored_path, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.body.companyId || null, req.body.exceptionId || null, req.body.outstandingId || null, req.body.documentType || 'OTHER', req.file.originalname, stored, req.user.username]
  );
  await audit.record({ username: req.user.username, action: 'DOCUMENT_UPLOAD', entity: 'document', entityId: result.rows[0].id });
  res.json(result.rows[0]);
});

app.get('/api/reports/:type.csv', async (req, res) => {
  const type = req.params.type;
  let rows = [];
  if (type === 'outstanding') rows = (await dashboard.outstanding({ ...req.query, pageSize: 5000 })).items;
  else if (type === 'gaps' || type === 'reconciliation') rows = await dashboard.gaps(req.query);
  else if (type === 'exceptions') rows = await dashboard.listExceptions({ ...req.query, status: null });
  else if (type === 'quality') rows = [await dashboard.dataQuality(req.query)];
  else return res.status(404).json({ error: 'Unknown report' });
  const keys = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const csv = [keys.join(','), ...rows.map((row) => keys.map((key) => JSON.stringify(row[key] ?? '')).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
  res.send(csv);
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.status ? error.message : 'Unable to complete request', code: error.code });
});

async function start() {
  await db.migrate();
  const server = app.listen(config.port, config.host, () => {
    console.log('Intelligence API listening on port ' + config.port);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      server.close(() => db.close().then(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10000).unref();
    });
  }
  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Failed to start intelligence API:', error.message);
    db.close().finally(() => {
      process.exitCode = 1;
    });
  });
}

module.exports = { app, start };
