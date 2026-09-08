const { XMLParser } = require('fast-xml-parser');
const config = require('./config');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => ['COMPANY', 'LEDGER', 'VOUCHER', 'COLLECTION'].includes(name.toUpperCase()),
});

function envelope(innerBody, header = {}) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>${header.request || 'Export'}</TALLYREQUEST>
    <TYPE>${header.type || 'Collection'}</TYPE>
    <ID>${header.id || ''}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        ${header.company ? `<SVCURRENTCOMPANY>${escapeXml(header.company)}</SVCURRENTCOMPANY>` : ''}
        ${header.fromDate ? `<SVFROMDATE>${header.fromDate}</SVFROMDATE>` : ''}
        ${header.toDate ? `<SVTODATE>${header.toDate}</SVTODATE>` : ''}
      </STATICVARIABLES>
      ${innerBody || ''}
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tallyUrl() {
  return `http://${config.tally.host}:${config.tally.port}`;
}

let cachedPing = { at: 0, value: null };

async function postXml(xml, timeoutMs = config.tally.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(tallyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Tally HTTP ${response.status}`);
    }

    const text = await response.text();
    return { ok: true, text, data: parser.parse(text) };
  } catch (error) {
    const refused = error.cause?.code === 'ECONNREFUSED' || String(error.message).includes('fetch failed');
    const message = error.name === 'AbortError'
      ? `Tally timed out at ${tallyUrl()}`
      : refused
        ? `Tally is not reachable at ${tallyUrl()}. Enable HTTP Server in Tally (F12 > Advanced Configuration).`
        : error.message;
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function deepFind(node, key, acc = []) {
  if (!node || typeof node !== 'object') {
    return acc;
  }

  for (const [k, v] of Object.entries(node)) {
    if (k.toUpperCase() === key.toUpperCase()) {
      acc.push(...asArray(v));
    }
    if (v && typeof v === 'object') {
      deepFind(v, key, acc);
    }
  }

  return acc;
}

function companyNameFromNode(node) {
  if (typeof node === 'string') return node;
  return node.NAME || node.Name || node.name || node['#text'] || '';
}

async function ping({ fresh = false } = {}) {
  if (!fresh && cachedPing.value && Date.now() - cachedPing.at < 20000) {
    return cachedPing.value;
  }

  const xml = envelope(`
    <TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="CompanyCollection" ISMODIFY="No">
          <TYPE>Company</TYPE>
          <NATIVEMETHOD>Name</NATIVEMETHOD>
        </COLLECTION>
      </TDLMESSAGE>
    </TDL>
  `, { id: 'CompanyCollection' });

  const result = await postXml(xml, 2500);
  if (!result.ok) {
    cachedPing = {
      at: Date.now(),
      value: {
        connected: false,
        url: tallyUrl(),
        message: result.error,
        companies: [],
      },
    };
    return cachedPing.value;
  }

  const names = deepFind(result.data, 'COMPANY')
    .map(companyNameFromNode)
    .filter(Boolean);

  cachedPing = {
    at: Date.now(),
    value: {
      connected: true,
      url: tallyUrl(),
      message: names.length ? `Connected · ${names.length} company(ies)` : 'Connected to Tally',
      companies: names,
    },
  };
  return cachedPing.value;
}

function parseAmount(value, { absolute = true } = {}) {
  if (value == null || value === '') return 0;
  const numeric = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return absolute ? Math.abs(numeric) : numeric;
}

function textValue(node, keys) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  for (const key of keys) {
    const value = node[key];
    if (value == null) continue;
    if (typeof value === 'object') {
      return String(value['#text'] || value.NAME || value.Name || '');
    }
    return String(value);
  }
  return '';
}

function currentFyRange() {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    from: `${startYear}0401`,
    to: `${startYear + 1}0331`,
  };
}

function parseTallyDate(value) {
  const raw = String(value || '').replace(/[-/]/g, '');
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function classifyLedger(parent = '') {
  const group = String(parent).toLowerCase();
  if (group.includes('sales')) return 'revenue';
  if (group.includes('purchase')) return 'purchases';
  if (group.includes('direct expenses') || group.includes('indirect expenses') || group.includes('expense')) {
    return 'expenses';
  }
  if (group.includes('sundry debtor')) return 'receivables';
  if (group.includes('sundry creditor')) return 'payables';
  if (group.includes('bank') || group.includes('cash')) return 'cash';
  return 'other';
}

async function fetchCompanyLedgers(companyName) {
  const xml = envelope(`
    <TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="LedgerBalances" ISMODIFY="No">
          <TYPE>Ledger</TYPE>
          <FETCH>Name, Parent, ClosingBalance</FETCH>
        </COLLECTION>
      </TDLMESSAGE>
    </TDL>
  `, { id: 'LedgerBalances', company: companyName });

  const result = await postXml(xml);
  if (!result.ok) {
    throw new Error(result.error);
  }

  return deepFind(result.data, 'LEDGER')
    .map((ledger) => {
      const name = textValue(ledger, ['NAME', 'Name', 'LEDGERNAME', '#text']);
      const parent = textValue(ledger, ['PARENT', 'Parent']);
      const balance = parseAmount(ledger.CLOSINGBALANCE || ledger.ClosingBalance, { absolute: false });
      return {
        name,
        parent,
        balance,
        bucket: classifyLedger(parent),
      };
    })
    .filter((ledger) => ledger.name);
}

async function fetchCompanyFinancials(companyName) {
  const ledgers = await fetchCompanyLedgers(companyName);
  const totals = {
    revenue: 0,
    expenses: 0,
    receivables: 0,
    payables: 0,
    cash: 0,
  };

  for (const ledger of ledgers) {
    const amount = Math.abs(ledger.balance);
    if (ledger.bucket === 'purchases' || ledger.bucket === 'expenses') {
      totals.expenses += amount;
    } else if (totals[ledger.bucket] != null) {
      totals[ledger.bucket] += amount;
    }
  }

  return { totals, ledgers };
}

function toTallyDate(value) {
  const raw = String(value || '').replace(/[-/]/g, '');
  return /^\d{8}$/.test(raw) ? raw : '';
}

async function fetchCompanyVouchers(companyName, { from, to } = {}) {
  const range = currentFyRange();
  const xml = envelope(`
    <TDL>
      <TDLMESSAGE>
        <COLLECTION NAME="VoucherCollection" ISMODIFY="No">
          <TYPE>Voucher</TYPE>
          <FETCH>Date, VoucherTypeName, VoucherNumber, Narration, Amount, PartyLedgerName</FETCH>
        </COLLECTION>
      </TDLMESSAGE>
    </TDL>
  `, {
    id: 'VoucherCollection',
    company: companyName,
    fromDate: toTallyDate(from) || range.from,
    toDate: toTallyDate(to) || range.to,
  });

  const timeout = Math.max(config.tally.timeoutMs, 20000);
  const result = await postXml(xml, timeout);
  if (!result.ok) {
    throw new Error(result.error);
  }

  return deepFind(result.data, 'VOUCHER')
    .map((voucher) => ({
      date: parseTallyDate(voucher.DATE || voucher.Date),
      type: textValue(voucher, ['VOUCHERTYPENAME', 'VoucherTypeName', 'VOUCHERTYPE']) || 'Journal',
      number: textValue(voucher, ['VOUCHERNUMBER', 'VoucherNumber', 'NUMBER']),
      narration: textValue(voucher, ['NARRATION', 'Narration']),
      party: textValue(voucher, ['PARTYLEDGERNAME', 'PartyLedgerName']),
      amount: parseAmount(voucher.AMOUNT || voucher.Amount, { absolute: false }),
    }))
    .filter((voucher) => voucher.date);
}

module.exports = {
  ping,
  fetchCompanyLedgers,
  fetchCompanyFinancials,
  fetchCompanyVouchers,
  tallyUrl,
};
