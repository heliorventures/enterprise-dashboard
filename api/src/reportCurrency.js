const db = require('./db');
const { companyFilter } = require('./filters');

const supported = new Set(Intl.supportedValuesOf('currency'));
function currencyCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return supported.has(code) && code !== 'XXX' && code !== 'XTS' ? code : null;
}

async function reportingCurrency(company = 'all') {
  const result = await db.query(
    `SELECT s.currency, s.coverage->>'uniformCurrency' AS uniform_currency
     FROM "Companies" c LEFT JOIN finance_snapshots s ON s.company_id=c."CompanyID"
     WHERE c."IsActive" = true AND ($1=0 OR c."CompanyID"=$1)`,
    [companyFilter(company)],
  );
  const codes = result.rows.map(row => currencyCode(row.currency));
  if (codes.some(code => !code) || result.rows.some(row => row.uniform_currency !== 'true')) {
    throw Object.assign(new Error('Reporting currency is unknown or unsupported. Publish a validated company snapshot with a confirmed currency basis.'), { status: 422 });
  }
  if (new Set(codes).size > 1) {
    throw Object.assign(new Error('Selected companies have different currencies. Choose one company to view monetary reports; no currency conversion is applied.'), { status: 422 });
  }
  return codes[0] || null;
}

function withReportingCurrency(work) {
  return (query = {}) => {
    companyFilter(query.company);
    return db.readSnapshot(async () => {
      const currency = await reportingCurrency(query.company);
      const result = await work(query);
      if (result.companies) {
        result.companies = result.companies.map(company => ({
          ...company, currency,
          ...(company.projects ? { projects: company.projects.map(project => ({ ...project, currency })) } : {}),
        }));
      }
      return { ...result, currency };
    });
  };
}

module.exports = { currencyCode, reportingCurrency, withReportingCurrency };
