const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const dashboardService = require('./dashboardService');
const books = require('./books');
const tally = require('./tally');
const { registerTallyRoutes } = require('./tallyRoutes');

const app = express();

app.use(cors({ origin: ['http://localhost:4200'] }));
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await db.getPool();
    res.json({
      ok: true,
      service: 'api',
      database: 'connected',
      tally: {
        url: tally.tallyUrl(),
        host: config.tally.host,
        port: config.tally.port,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, service: 'api', database: error.message });
  }
});

app.get('/api/companies', async (_req, res) => {
  try {
    const companies = await dashboardService.getCompanies();
    res.json(companies.map((row) => ({ id: String(row.CompanyID), name: row.CompanyName })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const company = String(req.query.company || 'all');
    const dashboard = await dashboardService.getDashboard(company);
    res.json(dashboard);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

registerTallyRoutes(app);

async function start() {
  await db.getPool();
  app.listen(config.port, config.host, () => {
    console.log(`API listening on http://localhost:${config.port}`);
    console.log(`Tally live data:`);
    console.log(`  GET  /api/tally/status`);
    console.log(`  GET  /api/tally/companies`);
    console.log(`  GET  /api/tally/ledgers?company=Name`);
    console.log(`  GET  /api/tally/vouchers?company=Name`);
    console.log(`  GET  /api/tally/financials?company=Name`);
    console.log(`  POST /api/tally/sync`);
    console.log(`Tally target ${config.tally.host}:${config.tally.port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start API', error);
  process.exit(1);
});
