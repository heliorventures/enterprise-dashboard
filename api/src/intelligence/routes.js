const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const config = require('./config');
const imports = require('./imports/service');
const dashboard = require('./dashboard/service');
const sync = require('./sync/service');
const projects = require('./projects/service');
const projectReport = require('./projects/report');
const presence = require('./presence');
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
  app.get('/api/imports/sync/:id/ledgers', wrap(async (req, res) => {
    reports.keys(req.query, ['q']);
    res.json(await sync.listLedgers({ reconciliationId: reports.uuid(req.params.id), q: reports.text(req.query.q, 'q') }));
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
    reports.keys(req.body, ['mappings','currency']);
    if (req.body.currency !== undefined && req.body.currency !== null && !require('../reportCurrency').currencyCode(req.body.currency)) throw reports.bad('currency must be a supported ISO code or null');
    const mappings = req.body.mappings;
    if (!Array.isArray(mappings) || mappings.length > 1000) throw reports.bad('mappings must be an array of at most 1000 columns');
    for (const mapping of mappings) {
      reports.keys(mapping, ['sourceHeader', 'targetField']);
      if (!reports.text(mapping.sourceHeader, 'sourceHeader', 500)?.trim()) throw reports.bad('sourceHeader is required');
      if (mapping.targetField !== null && !reports.text(mapping.targetField, 'targetField', 100)?.trim()) {
        throw reports.bad('targetField must be explicit text or null to ignore the column');
      }
    }
    res.json(await imports.updateMapping(reports.uuid(req.params.id), mappings, actor(req),req.body.currency));
  }));

  // Project-wise view of the same Excel data. Registered before /api/imports/:id.
  const projectCompany = async value => {
    if (!reports.company(value)) throw reports.bad('Select a company');
    return intelCompanyId(value);
  };
  const tallyProjectId = value => (value === null || value === undefined ? value
    : reports.integer(value, 'tallyProjectId', undefined, 2147483647));
  const projectBody = (body, allowed) => {
    reports.keys(body, allowed);
    return {
      ...(body.name !== undefined ? { name: reports.text(body.name, 'name', 120) } : {}),
      ...(body.tallyProjectId !== undefined ? { tallyProjectId: tallyProjectId(body.tallyProjectId) } : {}),
      ...(body.budgetExpense !== undefined ? { budgetExpense: body.budgetExpense } : {}),
      ...(body.targetRevenue !== undefined ? { targetRevenue: body.targetRevenue } : {}),
    };
  };
  app.get('/api/imports/projects', wrap(async (req, res) => {
    reports.keys(req.query, ['company']);
    res.json(await projects.summary(await projectCompany(req.query.company)));
  }));
  app.get('/api/imports/projects/suggestions', wrap(async (req, res) => {
    reports.keys(req.query, ['company']);
    res.json(await projects.suggestions(await projectCompany(req.query.company)));
  }));
  // What exists in Excel but not in Tally, and the other way round. Name based, so it
  // works even when amounts cannot be compared.
  app.get('/api/imports/missing', wrap(async (req, res) => {
    reports.keys(req.query, ['company']);
    res.json(await presence.presence(await projectCompany(req.query.company)));
  }));
  app.get('/api/imports/missing/report/:format', wrap(async (req, res) => {
    reports.keys(req.query, ['company']);
    const format = req.params.format;
    if (!['xlsx', 'csv'].includes(format)) { res.status(404).json({ error: 'Report not found' }); return; }
    const data = await presence.presence(await projectCompany(req.query.company));
    res.setHeader('Content-Disposition', `attachment; filename="${presence.fileName(data.company, format)}"`);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(presence.toCsv(data));
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(await presence.toWorkbook(data));
  }));
  // Progress by upload, one project or all of them.
  app.get('/api/imports/projects/history', wrap(async (req, res) => {
    reports.keys(req.query, ['company', 'project']);
    const project = req.query.project === undefined ? undefined : req.query.project === 'unassigned' ? 'unassigned' : reports.uuid(req.query.project);
    res.json(await projects.history(await projectCompany(req.query.company), project));
  }));
  // Difference report between Tally and the uploaded Excel, grouped by project.
  app.get('/api/imports/projects/report/:format', wrap(async (req, res) => {
    reports.keys(req.query, ['company']);
    const format = req.params.format;
    if (!['xlsx', 'csv'].includes(format)) { res.status(404).json({ error: 'Report not found' }); return; }
    const report = await projectReport.build(await projectCompany(req.query.company));
    const name = projectReport.fileName(report.company, format);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(projectReport.toCsv(report));
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(await projectReport.toWorkbook(report));
  }));
  app.post('/api/imports/projects/apply', wrap(async (req, res) => {
    reports.keys(req.body, ['company']);
    res.json(await projects.reapply(await projectCompany(req.body.company), actor(req)));
  }));
  app.post('/api/imports/projects', wrap(async (req, res) => {
    const fields = projectBody(req.body, ['company', 'name', 'tallyProjectId', 'budgetExpense', 'targetRevenue', 'keywords']);
    const keywords = req.body.keywords === undefined ? [] : req.body.keywords;
    if (!Array.isArray(keywords) || keywords.length > 20) throw reports.bad('keywords must be a list of at most 20 words');
    res.status(201).json(await projects.createProject(await projectCompany(req.body.company), { ...fields, keywords }, actor(req)));
  }));
  app.delete('/api/imports/projects/rules/:ruleId', wrap(async (req, res) => {
    res.json(await projects.deleteRule(reports.uuid(req.params.ruleId), actor(req)));
  }));
  app.post('/api/imports/projects/:id/rules', wrap(async (req, res) => {
    reports.keys(req.body, ['keyword']);
    res.status(201).json(await projects.addRule(reports.uuid(req.params.id), reports.text(req.body.keyword, 'keyword', 80), actor(req)));
  }));
  app.put('/api/imports/projects/:id', wrap(async (req, res) => {
    res.json(await projects.updateProject(reports.uuid(req.params.id), projectBody(req.body, ['name', 'tallyProjectId', 'budgetExpense', 'targetRevenue']), actor(req)));
  }));
  app.delete('/api/imports/projects/:id', wrap(async (req, res) => {
    res.json(await projects.deleteProject(reports.uuid(req.params.id), actor(req)));
  }));
  app.get('/api/imports/projects/:id', wrap(async (req, res) => {
    reports.keys(req.query, ['company', 'q', 'status', 'page', 'pageSize']);
    const { status: rawStatus, ...rest } = req.query;
    const filters = reports.filters({ ...rest, company: undefined }, 'reconciliation', []);
    const status = rawStatus === 'differences' ? 'differences' : reports.status(rawStatus, 'reconciliation', 'all') ?? 'all';
    const id = req.params.id === 'unassigned' ? null : reports.uuid(req.params.id);
    res.json(await projects.detail(await projectCompany(req.query.company), id,
      { q: filters.q, status, page: filters.page, pageSize: filters.pageSize }));
  }));
  app.put('/api/imports/accounts/:id/project', wrap(async (req, res) => {
    reports.keys(req.body, ['projectId']);
    const projectId = req.body.projectId === null ? null : reports.uuid(req.body.projectId);
    res.json(await projects.assignAccount(reports.uuid(req.params.id), projectId, actor(req)));
  }));

  app.get('/api/imports/:id', wrap(async (req, res) => {
    res.json(await imports.getResults(reports.uuid(req.params.id)));
  }));
}

module.exports = { registerExcelImportRoutes };
