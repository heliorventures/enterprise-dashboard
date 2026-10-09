const db = require('./db');
const { companyFilter, optionalDate } = require('./filters');
const { classifyVoucher, money } = require('./funds');

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function period(from, to) {
  const start = optionalDate(from) || daysAgo(90);
  const end = optionalDate(to) || todayUtc();
  if (start > end) {
    throw Object.assign(new Error('from must be on or before to'), { status: 400 });
  }
  return { from: start, to: end };
}

function voucherWhere() {
  return `
    c."IsActive" = true
    AND ($1 = 0 OR v."CompanyID" = $1)
    AND ($2 = '' OR v."VoucherType" = $2)
    AND v."VoucherDate" >= $3::date
    AND v."VoucherDate" <= $4::date
  `;
}

function params({ company = 'all', type = '', from, to } = {}) {
  const range = period(from, to);
  return {
    range,
    values: [companyFilter(company), String(type || '').trim(), range.from, range.to],
  };
}

function flowExpr(kind) {
  if (kind === 'inflow') {
    return `CASE WHEN v."VoucherType" ~* 'receipt|sales|credit\\s*note' THEN abs(COALESCE(v."Amount",0)) ELSE 0 END`;
  }
  if (kind === 'outflow') {
    return `CASE WHEN v."VoucherType" ~* 'payment|purchase|debit\\s*note' THEN abs(COALESCE(v."Amount",0)) ELSE 0 END`;
  }
  return 'abs(COALESCE(v."Amount",0))';
}

function mapRow(row) {
  const vouchers = Number(row.vouchers) || 0;
  const withAmount = Number(row.with_amount) || 0;
  const turnover = money(row.turnover);
  const inflow = money(row.inflow);
  const outflow = money(row.outflow);
  return {
    ...row,
    vouchers,
    withAmount,
    turnover,
    inflow,
    outflow,
    net: money(inflow - outflow),
    missingAmount: Math.max(0, vouchers - withAmount),
  };
}

async function typesFor(companyId) {
  const result = await db.query(
    `
      SELECT DISTINCT v."VoucherType" AS name
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE c."IsActive" = true AND ($1 = 0 OR v."CompanyID" = $1)
      ORDER BY v."VoucherType"
    `,
    [companyId]
  );
  return result.rows.map((row) => row.name).filter(Boolean);
}

async function summary(query) {
  const { range, values } = params(query);
  const [totals, typeRows] = await Promise.all([
    db.query(
      `
        SELECT
          count(*)::int AS vouchers,
          count(*) FILTER (WHERE COALESCE(v."Amount",0) <> 0)::int AS with_amount,
          COALESCE(sum(${flowExpr('turnover')}),0) AS turnover,
          COALESCE(sum(${flowExpr('inflow')}),0) AS inflow,
          COALESCE(sum(${flowExpr('outflow')}),0) AS outflow,
          count(DISTINCT v."CompanyID")::int AS companies,
          count(DISTINCT v."VoucherDate")::int AS days
        FROM "Vouchers" v
        INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
        WHERE ${voucherWhere()}
      `,
      values
    ),
    typesFor(values[0]),
  ]);
  return {
    period: range,
    types: typeRows,
    cards: mapRow(totals.rows[0]),
  };
}

async function daily(query) {
  const { range, values } = params(query);
  const result = await db.query(
    `
      SELECT
        v."VoucherDate" AS date,
        count(*)::int AS vouchers,
        count(*) FILTER (WHERE COALESCE(v."Amount",0) <> 0)::int AS with_amount,
        COALESCE(sum(${flowExpr('turnover')}),0) AS turnover,
        COALESCE(sum(${flowExpr('inflow')}),0) AS inflow,
        COALESCE(sum(${flowExpr('outflow')}),0) AS outflow
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE ${voucherWhere()}
      GROUP BY v."VoucherDate"
      ORDER BY v."VoucherDate" DESC
    `,
    values
  );
  return { period: range, items: result.rows.map(mapRow) };
}

async function weekly(query) {
  const { range, values } = params(query);
  const result = await db.query(
    `
      SELECT
        date_trunc('week', v."VoucherDate")::date AS week_start,
        (date_trunc('week', v."VoucherDate")::date + 6) AS week_end,
        to_char(date_trunc('week', v."VoucherDate"), 'IYYY-"W"IW') AS week_label,
        count(*)::int AS vouchers,
        count(*) FILTER (WHERE COALESCE(v."Amount",0) <> 0)::int AS with_amount,
        COALESCE(sum(${flowExpr('turnover')}),0) AS turnover,
        COALESCE(sum(${flowExpr('inflow')}),0) AS inflow,
        COALESCE(sum(${flowExpr('outflow')}),0) AS outflow
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE ${voucherWhere()}
      GROUP BY 1, 2, 3
      ORDER BY 1 DESC
    `,
    values
  );
  return { period: range, items: result.rows.map(mapRow) };
}

async function monthly(query) {
  const { range, values } = params(query);
  const result = await db.query(
    `
      SELECT
        to_char(date_trunc('month', v."VoucherDate"), 'YYYY-MM') AS month_key,
        to_char(date_trunc('month', v."VoucherDate"), 'Mon YYYY') AS month_label,
        count(*)::int AS vouchers,
        count(*) FILTER (WHERE COALESCE(v."Amount",0) <> 0)::int AS with_amount,
        COALESCE(sum(${flowExpr('turnover')}),0) AS turnover,
        COALESCE(sum(${flowExpr('inflow')}),0) AS inflow,
        COALESCE(sum(${flowExpr('outflow')}),0) AS outflow
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE ${voucherWhere()}
      GROUP BY 1, 2
      ORDER BY 1 DESC
    `,
    values
  );
  return { period: range, items: result.rows.map(mapRow) };
}

async function types(query) {
  const { range, values } = params(query);
  const result = await db.query(
    `
      SELECT
        COALESCE(v."VoucherType", 'Unknown') AS voucher_type,
        count(*)::int AS vouchers,
        count(*) FILTER (WHERE COALESCE(v."Amount",0) <> 0)::int AS with_amount,
        COALESCE(sum(${flowExpr('turnover')}),0) AS turnover,
        COALESCE(sum(${flowExpr('inflow')}),0) AS inflow,
        COALESCE(sum(${flowExpr('outflow')}),0) AS outflow
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE ${voucherWhere()}
      GROUP BY 1
      ORDER BY abs(COALESCE(sum(${flowExpr('turnover')}),0)) DESC, count(*) DESC
    `,
    values
  );
  return {
    period: range,
    items: result.rows.map((row) => ({
      ...mapRow(row),
      flow: classifyVoucher(row.voucher_type),
    })),
  };
}

async function parties(query) {
  const { range, values } = params(query);
  const result = await db.query(
    `
      SELECT
        COALESCE(NULLIF(v."PartyLedgerName", ''), '(No party)') AS party,
        count(*)::int AS vouchers,
        count(*) FILTER (WHERE COALESCE(v."Amount",0) <> 0)::int AS with_amount,
        COALESCE(sum(${flowExpr('turnover')}),0) AS turnover,
        COALESCE(sum(${flowExpr('inflow')}),0) AS inflow,
        COALESCE(sum(${flowExpr('outflow')}),0) AS outflow
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE ${voucherWhere()}
      GROUP BY 1
      ORDER BY abs(COALESCE(sum(${flowExpr('turnover')}),0)) DESC
      LIMIT 40
    `,
    values
  );
  return { period: range, items: result.rows.map(mapRow) };
}

async function companies(query) {
  const { range, values } = params(query);
  const result = await db.query(
    `
      SELECT
        c."CompanyID" AS company_id,
        c."CompanyName" AS company_name,
        count(*)::int AS vouchers,
        count(*) FILTER (WHERE COALESCE(v."Amount",0) <> 0)::int AS with_amount,
        COALESCE(sum(${flowExpr('turnover')}),0) AS turnover,
        COALESCE(sum(${flowExpr('inflow')}),0) AS inflow,
        COALESCE(sum(${flowExpr('outflow')}),0) AS outflow
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE ${voucherWhere()}
      GROUP BY c."CompanyID", c."CompanyName"
      ORDER BY abs(COALESCE(sum(${flowExpr('turnover')}),0)) DESC
    `,
    values
  );
  return { period: range, items: result.rows.map((row) => ({ ...mapRow(row), companyId: String(row.company_id) })) };
}

async function large(query) {
  const { range, values } = params(query);
  const minAmount = Number(query.minAmount);
  const threshold = Number.isFinite(minAmount) && minAmount > 0 ? minAmount : 100000;
  const result = await db.query(
    `
      SELECT
        v."VoucherID" AS id,
        v."VoucherDate" AS date,
        v."VoucherType" AS voucher_type,
        v."VoucherNumber" AS voucher_number,
        v."PartyLedgerName" AS party,
        v."Narration" AS narration,
        c."CompanyName" AS company_name,
        c."CompanyID" AS company_id,
        COALESCE(v."Amount",0) AS amount,
        abs(COALESCE(v."Amount",0)) AS turnover
      FROM "Vouchers" v
      INNER JOIN "Companies" c ON c."CompanyID" = v."CompanyID"
      WHERE ${voucherWhere()}
        AND abs(COALESCE(v."Amount",0)) >= $5
      ORDER BY abs(COALESCE(v."Amount",0)) DESC, v."VoucherDate" DESC
      LIMIT 100
    `,
    [...values, threshold]
  );
  return {
    period: range,
    minAmount: threshold,
    items: result.rows.map((row) => ({
      ...row,
      companyId: String(row.company_id),
      amount: money(row.amount),
      turnover: money(row.turnover),
      flow: classifyVoucher(row.voucher_type),
    })),
  };
}

async function run(kind, query) {
  if (kind === 'summary') return summary(query);
  if (kind === 'daily') return daily(query);
  if (kind === 'weekly') return weekly(query);
  if (kind === 'monthly') return monthly(query);
  if (kind === 'types') return types(query);
  if (kind === 'parties') return parties(query);
  if (kind === 'companies') return companies(query);
  if (kind === 'large') return large(query);
  throw Object.assign(new Error('Unknown management report'), { status: 404 });
}

module.exports = { run, summary, daily, weekly, monthly, types, parties, companies, large };
