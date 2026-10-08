const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const config = require('./config');
const imports = require('./imports/service');
const dashboard = require('./dashboard/service');
const sync = require('./sync/service');
const { migrate } = require('./migrate');

fs.mkdirSync(path.join(config.storageDir, 'imports'), { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error('Excel import failed:', error.code || error.message, error.stack);
      res.status(status).json({
        error: error.status || error.code
          ? error.message
          : 'Unable to complete Excel import request',
      });
    }
  };
}

async function intelCompanyId(company) {
  if (!company || company === 'all') return null;
  const tallyId = Number(company);
  if (!Number.isInteger(tallyId) || tallyId <= 0) return '00000000-0000-0000-0000-000000000000';
  const result = await db.query('SELECT id FROM intel_companies WHERE tally_company_id=$1', [tallyId]);
  return result.rows[0]?.id || '00000000-0000-0000-0000-000000000000';
}

function actor(req) {
  return req.user?.name || req.user?.username || 'dashboard';
}

function registerExcelImportRoutes(app) {
  app.get('/api/imports/fields', wrap(async (_req, res) => {
    const result = await db.query('SELECT * FROM intel_field_catalog ORDER BY group_name, field_key');
    res.json(result.rows);
  }));
  app.get('/api/imports/summary', wrap(async (req, res) => {
    res.json(await dashboard.summary({ companyId: await intelCompanyId(req.query.company) }));
  }));
  app.get('/api/imports/outstanding', wrap(async (req, res) => {
    res.json(await dashboard.outstanding({ ...req.query, companyId: await intelCompanyId(req.query.company) }));
  }));
  app.get('/api/imports/ageing', wrap(async (req, res) => {
    res.json(await dashboard.ageing({ companyId: await intelCompanyId(req.query.company) }));
  }));
  app.get('/api/imports/reconciliation', wrap(async (req, res) => {
    res.json(await dashboard.gaps({ ...req.query, companyId: await intelCompanyId(req.query.company) }));
  }));
  app.get('/api/imports/exceptions', wrap(async (req, res) => {
    res.json(await dashboard.listExceptions({ ...req.query, companyId: await intelCompanyId(req.query.company) }));
  }));
  app.get('/api/imports/accounts/:id', wrap(async (req, res) => {
    res.json(await dashboard.accountDetail(req.params.id));
  }));
  app.get('/api/imports/tally-ledgers', wrap(async (req, res) => {
    res.json(await sync.listLedgers({ company: req.query.company, q: req.query.q }));
  }));
  app.get('/api/imports/sync', wrap(async (req, res) => {
    res.json(await sync.listSync({
      companyId: await intelCompanyId(req.query.company),
      status: req.query.status,
      q: req.query.q,
      minDifference: req.query.minDifference,
      mapped: req.query.mapped,
      page: req.query.page,
      pageSize: req.query.pageSize,
    }));
  }));
  app.get('/api/imports/sync/:id', wrap(async (req, res) => {
    res.json(await sync.detail(req.params.id));
  }));
  app.put('/api/imports/sync/:id/map', wrap(async (req, res) => {
    res.json(await sync.mapRecon(req.params.id, req.body?.tallyLedgerId, actor(req)));
  }));

  app.post('/api/imports/upload', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Excel file required' });
      return;
    }
    res.json(await imports.upload({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      companyId: req.body.companyId || null,
      uploadedBy: actor(req),
    }));
  }));
  app.get('/api/imports', wrap(async (_req, res) => {
    res.json(await imports.listImports());
  }));
  app.get('/api/imports/:id/preview', wrap(async (req, res) => {
    res.json(await imports.preview(req.params.id));
  }));
  app.post('/api/imports/:id/validate', wrap(async (req, res) => {
    res.json(await imports.validateOnly(req.params.id));
  }));
  app.get('/api/imports/:id/progress', wrap(async (req, res) => {
    res.json(await imports.getProgress(req.params.id));
  }));
  app.post('/api/imports/:id/process', wrap(async (req, res) => {
    res.json(await imports.startProcess(req.params.id, { username: actor(req) }));
  }));
  app.post('/api/imports/:id/reprocess', wrap(async (req, res) => {
    res.json(await imports.startProcess(req.params.id, { username: actor(req), reprocess: true }));
  }));
  app.get('/api/imports/:id/errors', wrap(async (req, res) => {
    res.json(await imports.rowErrors(req.params.id));
  }));
  app.put('/api/imports/:id/mapping', wrap(async (req, res) => {
    res.json(await imports.updateMapping(req.params.id, req.body.mappings || [], actor(req)));
  }));
  app.get('/api/imports/:id', wrap(async (req, res) => {
    res.json(await imports.getResults(req.params.id));
  }));
}

module.exports = { registerExcelImportRoutes, migrate };
