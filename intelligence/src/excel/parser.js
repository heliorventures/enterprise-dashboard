const ExcelJS = require('exceljs');

const AMOUNT_HINT = /(amount|amt|debit|credit|dr\b|cr\b|bill|paid)/i;
const DATE_HINT = /(date|dt)\b/i;

function cellValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const trimmed = value.replace(/\u00a0/g, ' ').trim();
    return trimmed || null;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return cellValue(value.richText.map((part) => part.text).join(''));
    if (value.result !== undefined) return cellValue(value.result);
    if (value.text) return cellValue(value.text);
    if (value.hyperlink && value.text) return cellValue(value.text);
    if (value.formula && value.result !== undefined) return cellValue(value.result);
  }
  return String(value);
}

function colLetterToNumber(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseMerge(range) {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(range);
  if (!match) return null;
  return {
    c1: colLetterToNumber(match[1].toUpperCase()),
    r1: Number(match[2]),
    c2: colLetterToNumber(match[3].toUpperCase()),
    r2: Number(match[4]),
  };
}

function rowValues(worksheet, rowNumber, colCount) {
  const row = worksheet.getRow(rowNumber);
  const values = [];
  for (let col = 1; col <= colCount; col += 1) values.push(cellValue(row.getCell(col).value));
  return values;
}

function fillMerged(valuesByRow, merges) {
  for (const range of merges || []) {
    const merge = parseMerge(range);
    if (!merge) continue;
    const source = valuesByRow[merge.r1]?.[merge.c1 - 1];
    if (source == null) continue;
    for (let r = merge.r1; r <= merge.r2; r += 1) {
      if (!valuesByRow[r]) continue;
      for (let c = merge.c1; c <= merge.c2; c += 1) {
        if (valuesByRow[r][c - 1] == null) valuesByRow[r][c - 1] = source;
      }
    }
  }
}

function parsePeriod(text) {
  if (!text) return { from: null, to: null, raw: null };
  const raw = String(text);
  const dates = [...raw.matchAll(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g)].map((m) => parseDate(m[1]));
  return { from: dates[0] || null, to: dates[1] || null, raw };
}

function parseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(text);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function parseDecimal(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100) / 100;
  const text = String(value).replace(/[,₹\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!text || text === '-') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100) / 100;
}

function parseInteger(value) {
  const n = parseDecimal(value);
  if (n == null || n === undefined) return n;
  return Math.round(n);
}

function normalizeSpace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function ageingFromHeader(text) {
  const compact = normalizeSpace(text).toLowerCase();
  if (!compact) return null;
  const dates = [...compact.matchAll(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g)].map((m) => parseDate(m[1]));
  let key = null;
  let label = normalizeSpace(text).split('\n')[0];
  if (/0\s*to\s*1/.test(compact)) {
    key = 'age_0_1_year';
    label = '0-1 Year';
  } else if (/1\s*to\s*2/.test(compact)) {
    key = 'age_1_2_year';
    label = '1-2 Year';
  } else if (/2\s*to\s*3/.test(compact)) {
    key = 'age_2_3_year';
    label = '2-3 Year';
  } else if (/3\s*(to\s*)?(above|\+|plus|years? and above)/.test(compact)) {
    key = 'age_3_plus_year';
    label = '3+ Year';
  }
  if (!key) return null;
  return { key, label, from: dates[1] || dates[0] || null, to: dates[0] || null, raw: normalizeSpace(text) };
}

function sideFromHeader(text) {
  const compact = normalizeSpace(text).toLowerCase();
  if (/^dr(\s*amt)?$/.test(compact) || /\bdebit\b/.test(compact) || compact === 'dr amt') return 'debit';
  if (/^cr(\s*amt)?$/.test(compact) || /\bcredit\b/.test(compact) || compact === 'cr amt') return 'credit';
  return null;
}

function guessTarget(canonical, parent, child) {
  const hay = `${canonical} ${parent} ${child}`.toLowerCase();
  if (/particular/.test(hay)) return 'account_name';
  if (/cr\s*days|credit\s*days/.test(hay)) return 'credit_days';
  if (/gst/.test(hay)) return 'gst_number';
  if (/msme/.test(hay)) return 'msme_number';
  if (/\bpan\b/.test(hay)) return 'pan_number';
  if (/reques?ition/.test(hay)) return 'last_payment_requisition_amount';
  if (/last payment amt|last payment amount/.test(hay) && !/reques?ition/.test(hay)) return 'last_payment_amount';
  if (/last payment date/.test(hay)) return 'last_payment_date';
  if (/bill amount/.test(hay) || (/up to date/.test(hay) && /bill/.test(hay))) return 'bill_amount';
  if (/paid amount/.test(hay)) return 'paid_amount';
  const ageing = ageingFromHeader(parent) || ageingFromHeader(canonical);
  const side = sideFromHeader(child) || sideFromHeader(canonical);
  if (ageing && side) return `${ageing.key}_${side === 'debit' ? 'debit' : 'credit'}`;
  if (/pending bill/.test(hay) && side === 'debit') return 'pending_bill_debit';
  if (/pending bill/.test(hay) && side === 'credit') return 'pending_bill_credit';
  if (/^last dt$/i.test(normalizeSpace(parent)) && !side) return 'last_date';
  if (/last dt|last date/.test(hay) && !side && DATE_HINT.test(hay)) return 'last_date';
  return null;
}

function buildColumns(parentRow, childRow, colCount) {
  const columns = [];
  for (let i = 0; i < colCount; i += 1) {
    const parent = normalizeSpace(parentRow[i] || '');
    const child = normalizeSpace(childRow[i] || '');
    const canonical = parent && child && parent.toLowerCase() !== child.toLowerCase()
      ? `${parent} | ${child}`
      : parent || child || `Column ${i + 1}`;
    const ageing = ageingFromHeader(parent);
    const target = guessTarget(canonical, parent, child);
    columns.push({
      index: i + 1,
      parent: parent || null,
      child: child || null,
      canonical,
      target,
      ageing,
      unmapped: !target,
      kind: target && /amount|debit|credit/.test(target) ? 'amount' : DATE_HINT.test(canonical) ? 'date' : 'text',
    });
  }
  return columns;
}

function refineColumnTargets(columns, valuesByRow, structure) {
  const sampleRows = [];
  for (let r = structure.dataStartRow; r <= structure.dataStartRow + 80; r += 1) {
    if (valuesByRow[r]) sampleRows.push(valuesByRow[r]);
  }
  const hasLastDate = columns.some((col) => col.target === 'last_date');
  if (hasLastDate) return columns;
  let lastDateIndex = -1;
  columns.forEach((col, index) => {
    if (col.target) return;
    if (AMOUNT_HINT.test(col.canonical) && !DATE_HINT.test(col.canonical)) return;
    const values = sampleRows.map((row) => row[col.index - 1]).filter((value) => value != null && value !== '');
    if (!values.length) return;
    const dates = values.filter((value) => typeof value !== 'number' && parseDate(value));
    if (dates.length >= Math.max(3, values.length * 0.6)) lastDateIndex = index;
  });
  if (lastDateIndex < 0) return columns;
  return columns.map((col, index) => (
    index === lastDateIndex ? { ...col, target: 'last_date', kind: 'date', unmapped: false } : col
  ));
}

function detectStructure(valuesByRow, colCount) {
  const rows = Object.keys(valuesByRow).map(Number).sort((a, b) => a - b);
  let titleRow = null;
  let periodRow = null;
  let entityRow = null;
  let headerRow = null;
  let subHeaderRow = null;
  for (const r of rows.slice(0, 20)) {
    const joined = valuesByRow[r].map((v) => (v == null ? '' : String(v))).join(' ');
    if (!titleRow && /report/i.test(joined)) titleRow = r;
    if (!periodRow && /from\s*:/i.test(joined)) periodRow = r;
    if (titleRow && periodRow && r > periodRow && !entityRow && normalizeSpace(valuesByRow[r][0])) entityRow = r;
    if (!headerRow && /particular/i.test(joined)) headerRow = r;
    if (headerRow && r === headerRow + 1 && /bill amount|dr amt|paid amount/i.test(joined)) subHeaderRow = r;
  }
  return {
    titleRow,
    periodRow,
    entityRow,
    headerRow: headerRow || 4,
    subHeaderRow: subHeaderRow || (headerRow ? headerRow + 1 : 5),
    dataStartRow: (subHeaderRow || (headerRow ? headerRow + 1 : 5)) + 1,
    colCount,
  };
}

function parseEntity(text) {
  const raw = normalizeSpace(text);
  if (!raw) return { company: null, units: [], raw: null };
  const match = raw.match(/^(.*?)\[(.*)\]$/);
  if (!match) return { company: raw, units: [], raw };
  const units = match[2].split(',').map((part) => normalizeSpace(part)).filter(Boolean);
  return { company: normalizeSpace(match[1]), units, raw };
}

function isTotalName(name) {
  return /^totals?$/i.test(normalizeSpace(name));
}

function classifyRow(raw, columns) {
  const name = normalizeSpace(raw.Particulars || raw.particulars || raw[columns[0]?.canonical] || '');
  if (!name) return 'IGNORED';
  if (isTotalName(name)) return 'TOTAL';
  const amountCols = columns.filter((col) => col.kind === 'amount' || /amount|debit|credit/i.test(col.target || ''));
  const hasAmount = amountCols.some((col) => {
    const value = raw[col.canonical];
    return value != null && value !== '' && (typeof value === 'number' || parseDecimal(value) != null);
  });
  if (!hasAmount) return 'GROUP';
  return 'DETAIL';
}

async function readWorkbook(source) {
  const workbook = new ExcelJS.Workbook();
  if (Buffer.isBuffer(source)) await workbook.xlsx.load(source);
  else await workbook.xlsx.readFile(source);
  return workbook;
}

async function analyzeWorkbook(source) {
  const workbook = await readWorkbook(source);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw Object.assign(new Error('Workbook has no worksheets'), { status: 400, code: 'NO_SHEET' });
  const colCount = Math.max(worksheet.actualColumnCount || 0, worksheet.columnCount || 0, 1);
  const rowCount = worksheet.actualRowCount || worksheet.rowCount || 0;
  const valuesByRow = {};
  for (let r = 1; r <= rowCount; r += 1) valuesByRow[r] = rowValues(worksheet, r, colCount);
  fillMerged(valuesByRow, worksheet.model?.merges);
  const structure = detectStructure(valuesByRow, colCount);
  const parentRow = valuesByRow[structure.headerRow] || [];
  const childRow = valuesByRow[structure.subHeaderRow] || [];
  const columns = refineColumnTargets(buildColumns(parentRow, childRow, colCount), valuesByRow, structure);
  const title = normalizeSpace(valuesByRow[structure.titleRow]?.[0] || '');
  const period = parsePeriod(valuesByRow[structure.periodRow]?.[0]);
  const entity = parseEntity(valuesByRow[structure.entityRow]?.[0]);
  const rows = [];
  let path = [];
  let lastType = null;
  for (let r = structure.dataStartRow; r <= rowCount; r += 1) {
    const values = valuesByRow[r] || [];
    const raw = {};
    columns.forEach((col, i) => {
      raw[col.canonical] = values[i] ?? null;
    });
    const particulars = normalizeSpace(values[0]);
    raw.Particulars = particulars;
    const rowType = classifyRow(raw, columns);
    if (rowType === 'GROUP') {
      path = lastType === 'GROUP' ? [...path, particulars] : [particulars];
      lastType = 'GROUP';
    } else if (rowType === 'DETAIL') {
      lastType = 'DETAIL';
    } else if (rowType === 'TOTAL') {
      lastType = 'TOTAL';
    }
    rows.push({
      sourceRowNumber: r,
      worksheet: worksheet.name,
      rowType,
      raw,
      categoryPath: rowType === 'DETAIL' ? [...path] : rowType === 'GROUP' ? [...path] : [],
    });
  }
  const counts = rows.reduce((acc, row) => {
    acc[row.rowType] = (acc[row.rowType] || 0) + 1;
    return acc;
  }, {});
  return {
    sheet: { name: worksheet.name, rows: rowCount, columns: colCount, merges: worksheet.model?.merges || [] },
    structure,
    title,
    period,
    entity,
    columns,
    rows,
    preview: rows.filter((row) => row.rowType === 'DETAIL').slice(0, 50),
    counts: {
      dataRows: counts.DETAIL || 0,
      groupRows: counts.GROUP || 0,
      totalRows: counts.TOTAL || 0,
      ignoredRows: counts.IGNORED || 0,
      headerRows: structure.dataStartRow - 1,
    },
  };
}

module.exports = {
  analyzeWorkbook,
  cellValue,
  parseDate,
  parseDecimal,
  parseInteger,
  parsePeriod,
  parseEntity,
  classifyRow,
  guessTarget,
  ageingFromHeader,
  buildColumns,
  normalizeSpace,
};
