const config = require('./config');
const tally = require('./tally');
const dashboardService = require('./dashboardService');

function matchCompany(requested, companies) {
  const name = String(requested || '').trim();
  if (!name) {
    return companies.length === 1 ? companies[0] : '';
  }

  const exact = companies.find((company) => company === name);
  if (exact) {
    return exact;
  }

  const lower = name.toLowerCase();
  return companies.find((company) => company.toLowerCase() === lower) || name;
}

async function requireTally(res) {
  const status = await tally.ping({ fresh: true });
  if (!status.connected) {
    res.status(503).json({
      error: status.message,
      connected: false,
      url: tally.tallyUrl(),
      companies: [],
    });
    return null;
  }
  return status;
}

async function resolveCompany(req, res, status) {
  const company = matchCompany(req.query.company, status.companies);
  if (!company) {
    res.status(400).json({
      error: 'Pass ?company=Company Name',
      companies: status.companies,
    });
    return null;
  }

  const known = status.companies.some((name) => name.toLowerCase() === company.toLowerCase());
  if (status.companies.length && !known) {
    res.status(404).json({
      error: `Company "${company}" was not found in Tally`,
      companies: status.companies,
    });
    return null;
  }

  return company;
}

function registerTallyRoutes(app) {
  app.get('/api/tally/status', async (_req, res) => {
    const status = await tally.ping({ fresh: true });
    res.status(status.connected ? 200 : 503).json({
      source: 'tally',
      host: config.tally.host,
      port: config.tally.port,
      url: tally.tallyUrl(),
      ...status,
    });
  });

  app.get('/api/tally/companies', async (_req, res) => {
    const status = await requireTally(res);
    if (!status) {
      return;
    }

    res.json({
      source: 'tally',
      connected: true,
      url: tally.tallyUrl(),
      companies: status.companies.map((name) => ({ name })),
    });
  });

  app.get('/api/tally/ledgers', async (req, res) => {
    const status = await requireTally(res);
    if (!status) {
      return;
    }

    const company = await resolveCompany(req, res, status);
    if (!company) {
      return;
    }

    try {
      const ledgers = await tally.fetchCompanyLedgers(company);
      res.json({
        source: 'tally',
        company,
        count: ledgers.length,
        items: ledgers,
      });
    } catch (error) {
      res.status(502).json({ error: error.message, company });
    }
  });

  app.get('/api/tally/vouchers', async (req, res) => {
    const status = await requireTally(res);
    if (!status) {
      return;
    }

    const company = await resolveCompany(req, res, status);
    if (!company) {
      return;
    }

    try {
      const vouchers = await tally.fetchCompanyVouchers(company, {
        from: req.query.from,
        to: req.query.to,
      });
      res.json({
        source: 'tally',
        company,
        count: vouchers.length,
        items: vouchers,
      });
    } catch (error) {
      res.status(502).json({ error: error.message, company });
    }
  });

  app.get('/api/tally/financials', async (req, res) => {
    const status = await requireTally(res);
    if (!status) {
      return;
    }

    const company = await resolveCompany(req, res, status);
    if (!company) {
      return;
    }

    try {
      const { totals, ledgers } = await tally.fetchCompanyFinancials(company);
      res.json({
        source: 'tally',
        company,
        totals,
        ledgerCount: ledgers.length,
        ledgers,
      });
    } catch (error) {
      res.status(502).json({ error: error.message, company });
    }
  });


}

module.exports = {
  registerTallyRoutes,
};
