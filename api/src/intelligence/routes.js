const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const config = require('./config');
const imports = require('./imports/service');
const dashboard = require('./dashboard/service');
const sync = require('./sync/service');
const audit = require('./audit');
const reports = require('./reports');

fs.mkdirSync(path.join(config.storageDir, 'imports'), { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

function receiveUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, error => {
      if (!error) return resolve();
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      reject(Object.assign(new Error(tooLarge ? 'Uploaded file exceeds 80 MB' : 'Invalid uploaded file'), {
        status: tooLarge ? 413 : 400,
      }));
    });
  });
}

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      if (status >= 500) console.error('Excel import failed:', error.code || error.message, error.stack);
      res.status(status).json({
        error: status < 500 ? error.message : 'Unable to complete Excel import request',
      });
    }
  };
}

async function intelCompanyId(company) {
  const tallyId = reports.company(company);
  if (!tallyId) return null;
  const result = await db.query('SELECT id FROM intel_companies WHERE tally_company_id=$1', [tallyId]);
  return result.rows[0]?.id || '00000000-0000-0000-0000-000000000000';
}

async function reportScope(query, kind, extraKeys = []) {
  const { company, ...scope } = reports.filters(query, kind, extraKeys);
  return { ...scope, companyId: await intelCompanyId(company === null ? undefined : company) };
}

async function companyScope(query) {
  reports.keys(query, ['company']);
  return { companyId: await intelCompanyId(query.company) };
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
    res.json(await dashboard.summary(await companyScope(req.query)));
  }));
  app.get('/api/imports/outstanding', wrap(async (req, res) => {
    res.json(await dashboard.outstanding(await reportScope(req.query)));
  }));
  app.get('/api/imports/ageing', wrap(async (req, res) => {
    res.json(await dashboard.ageing(await companyScope(req.query)));
  }));
  app.get('/api/imports/reconciliation', wrap(async (req, res) => {
    res.json(await dashboard.gaps(await reportScope(req.query)));
  }));
  app.get('/api/imports/exceptions', wrap(async (req, res) => {
    const owner = reports.text(req.query.owner, 'owner');
    res.json(await dashboard.listExceptionsPage({ ...await reportScope(req.query, 'exceptions', ['owner']), ...(owner !== undefined ? { owner } : {}) }));
  }));
  app.put('/api/imports/exceptions/:id', wrap(async (req, res) => {
    res.json(await dashboard.updateException(reports.uuid(req.params.id), reports.decision(req.body), actor(req)));
  }));
  app.get('/api/imports/quality', wrap(async (req, res) => {
    res.json(await dashboard.dataQuality(await companyScope(req.query)));
  }));
  app.get('/api/imports/audit', wrap(async (req, res) => {
    reports.keys(req.query, ['entity', 'limit']);
    const entity = reports.text(req.query.entity, 'entity', 50);
    if (entity && !/^[a-z][a-z0-9_]*$/.test(entity)) throw reports.bad('Unsupported audit entity');
    res.json(await audit.list({ entity, limit: reports.integer(req.query.limit, 'limit', 100, 500) }));
  }));
  app.get('/api/imports/reports/:type.csv', wrap(async (req, res) => {
    const type = req.params.type;
    if (!['outstanding', 'reconciliation', 'exceptions', 'quality'].includes(type)) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    const { company, q, status } = reports.filters(req.query, type === 'exceptions' ? 'exceptions' : 'reconciliation');
    const scope = { companyId: await intelCompanyId(company === null ? undefined : company), status: req.query.status === undefined ? null : status, q };
    const csv = await reports.report(type, scope);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
    res.send(csv);
  }));
  app.get('/api/imports/accounts/:id', wrap(async (req, res) => {
    res.json(await dashboard.accountDetail(reports.uuid(req.params.id)));
  }));
  app.get('/api/imports/tally-ledgers', wrap(async (req, res) => {
    reports.keys(req.query, ['company', 'q']);
    const company = reports.company(req.query.company);
    res.json(await sync.listLedgers({ company: company === null ? 'all' : company, q: reports.text(req.query.q, 'q') }));
  }));
  app.get('/api/imports/sync', wrap(async (req, res) => {
    const mapped = reports.text(req.query.mapped, 'mapped', 20);
    if (mapped && !['all', 'manual', 'unmapped', 'auto'].includes(mapped)) throw reports.bad('Unsupported mapped filter');
    const difference = reports.text(req.query.minDifference, 'minDifference', 50);
    if (difference !== undefined && (!/^\d+(?:\.\d+)?$/.test(difference) || !Number.isFinite(Number(difference)))) throw reports.bad('minDifference must be a nonnegative amount');
    res.json(await sync.listSync({ ...await reportScope(req.query, 'sync', ['minDifference', 'mapped']), mapped, minDifference: difference }));
  }));
  app.get('/api/imports/sync/:id', wrap(async (req, res) => {
    res.json(await sync.detail(reports.uuid(req.params.id)));
  }));
  app.put('/api/imports/sync/:id/map', wrap(async (req, res) => {
    reports.keys(req.body, ['tallyLedgerId']);
    const ledgerId = req.body.tallyLedgerId === null ? null : reports.integer(req.body.tallyLedgerId, 'tallyLedgerId', undefined, 2147483647);
    if (ledgerId === undefined) throw reports.bad('tallyLedgerId is required');
    res.json(await sync.mapRecon(reports.uuid(req.params.id), ledgerId, actor(req)));
  }));

  app.post('/api/imports/upload', wrap(async (req, res) => {
    await receiveUpload(req, res);
    if (!req.file) {
      res.status(400).json({ error: 'Excel file required' });
      return;
    }
    reports.keys(req.body, ['companyId']);
    const companyId = reports.company(req.body.companyId);
    if (!companyId) throw reports.bad('Select the company this Excel file belongs to');
    res.json(await imports.upload({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      companyId,
      uploadedBy: actor(req),
    }));
  }));
  app.get('/api/imports', wrap(async (_req, res) => {
    res.json(await imports.listImports());
  }));
  app.get('/api/imports/:id/preview', wrap(async (req, res) => {
    res.json(await imports.preview(reports.uuid(req.params.id)));
  }));
  app.post('/api/imports/:id/validate', wrap(async (req, res) => {
    res.json(await imports.validateOnly(reports.uuid(req.params.id)));
  }));
  app.get('/api/imports/:id/progress', wrap(async (req, res) => {
    res.json(await imports.getProgress(reports.uuid(req.params.id)));
  }));
  app.post('/api/imports/:id/process', wrap(async (req, res) => {
    res.json(await imports.startProcess(reports.uuid(req.params.id), { username: actor(req) }));
  }));
  app.post('/api/imports/:id/reprocess', wrap(async (req, res) => {
    res.json(await imports.startProcess(reports.uuid(req.params.id), { username: actor(req), reprocess: true }));
  }));
  app.get('/api/imports/:id/errors', wrap(async (req, res) => {
    res.json(await imports.rowErrors(reports.uuid(req.params.id)));
  }));
  app.put('/api/imports/:id/mapping', wrap(async (req, res) => {
    reports.keys(req.body, ['mappings']);
    const mappings = req.body.mappings;
    if (!Array.isArray(mappings) || mappings.length > 1000) throw reports.bad('mappings must be an array of at most 1000 columns');
    for (const mapping of mappings) {
      reports.keys(mapping, ['sourceHeader', 'targetField']);
      if (!reports.text(mapping.sourceHeader, 'sourceHeader', 500)?.trim()) throw reports.bad('sourceHeader is required');
      if (mapping.targetField !== null && !reports.text(mapping.targetField, 'targetField', 100)?.trim()) {
        throw reports.bad('targetField must be explicit text or null to ignore the column');
      }
    }
    res.json(await imports.updateMapping(reports.uuid(req.params.id), mappings, actor(req)));
  }));
  app.get('/api/imports/:id', wrap(async (req, res) => {
    res.json(await imports.getResults(reports.uuid(req.params.id)));
  }));
}

module.exports = { registerExcelImportRoutes };
