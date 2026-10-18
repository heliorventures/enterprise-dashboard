const ExcelJS = require('exceljs');
const projects = require('./service');
const { csv } = require('../reports');

const WHAT = {
  AMOUNT_MISMATCH: 'Amounts differ',
  PARTIALLY_MATCHED: 'Possible match - please check',
  MISSING_IN_TALLY: 'In Excel, not found in Tally',
  MISSING_IN_SOURCE: 'In Tally, not in Excel',
  COMPARISON_UNAVAILABLE: 'Cannot compare (currency not confirmed)',
};
const BUDGET = { ON_TRACK: 'On track', AT_RISK: 'At risk (80%+ used)', OVER_BUDGET: 'Over budget', NO_BUDGET: 'No budget set' };
const HEALTH = { IN_SYNC: 'In sync', HAS_GAPS: 'Has gaps', COMPARISON_UNAVAILABLE: 'Cannot compare', EMPTY: 'No data' };

/** Money is only shown when the import had one confirmed currency matching Tally. */
const money = (row, value) => (row.currency && value != null ? Number(value) : null);

function differenceLines(data) {
  const parties = data.parties.map(row => ({
    project: row.project_name,
    where: WHAT[row.status] || row.status || 'Not compared',
    excelName: row.account_name,
    tallyName: row.tally_ledger_name || '',
    excel: money(row, row.source_amount),
    tally: money(row, row.tally_amount),
    // Excel minus Tally. Positive: Excel shows more than Tally.
    difference: money(row, row.difference),
    currency: row.currency || '',
  }));
  const tally = data.tallyOnly.map(row => ({
    project: row.project_name,
    where: WHAT.MISSING_IN_SOURCE,
    excelName: '',
    tallyName: row.tally_ledger_name || '',
    excel: null,
    tally: money(row, row.tally_amount),
    difference: money(row, row.difference),
    currency: row.currency || '',
  }));
  return [...parties, ...tally];
}

async function build(companyId) {
  const [summary, data, history] = await Promise.all([
    projects.summary(companyId), projects.differences(companyId), projects.history(companyId, undefined, { limit: 500 }),
  ]);
  return { summary, lines: differenceLines(data), history: history.items, company: summary.company };
}

function fileName(company, ext) {
  const slug = String(company.name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'company';
  return `${slug}-project-difference-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function toCsv(report) {
  return csv(report.lines.map(line => ({
    'Project': line.project,
    'What is different': line.where,
    'Name in Excel': line.excelName,
    'Name in Tally': line.tallyName,
    'Excel amount': line.excel ?? '',
    'Tally amount': line.tally ?? '',
    'Difference (Excel minus Tally)': line.difference ?? '',
    'Currency': line.currency,
  })));
}

function sheet(workbook, name, columns, rows) {
  const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(column => ({ header: column.header, key: column.key, width: column.width || 16, style: column.numFmt ? { numFmt: column.numFmt } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  rows.forEach(row => ws.addRow(row));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

async function toWorkbook(report) {
  const { summary } = report;
  const amount = '#,##0.00';
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Helior Finance';
  workbook.created = new Date();

  const cover = workbook.addWorksheet('Summary');
  cover.getColumn(1).width = 30;
  const imported = summary.latestImport;
  [
    ['Tally vs Excel - project difference report'],
    [],
    ['Company', summary.company.name],
    ['Excel file', imported?.file_name || 'None imported'],
    ['Excel as on', imported?.reporting_date ? String(imported.reporting_date).slice(0, 10) : ''],
    ['Currency', summary.currency || 'Not confirmed'],
    ['Difference means', 'Excel amount minus Tally amount'],
    ['Report created', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
  ].forEach(line => cover.addRow(line));
  cover.getRow(1).font = { bold: true, size: 14 };
  for (const text of summary.notes || []) {
    const note = cover.addRow(['Note', text]);
    note.getCell(2).alignment = { wrapText: true };
  }
  if (!summary.monetaryAvailable) {
    const note = cover.addRow(['Note', summary.currencyMessage]);
    note.getCell(2).alignment = { wrapText: true };
  }
  cover.addRow([]);
  const table = [...summary.projects, summary.unassigned].filter(row => row.parties + row.tallyOnlyLedgers > 0 || row.id);
  const header = cover.addRow(['Project', 'Parties', 'Billed', 'Paid', 'Paid %', 'Still to pay', 'Budget', 'Budget used %', 'Budget status',
    'Matched', 'Different', 'Only in Tally', 'Total difference', 'Status', 'Excel total', 'Tally total', 'Excel minus Tally']);
  header.font = { bold: true };
  header.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; });
  const number = value => (value == null || value === '' ? null : Number(value));
  for (const row of table) {
    const added = cover.addRow([row.name, row.parties, number(row.billed), number(row.paid), row.paidPct, number(row.pending),
      summary.monetaryAvailable ? number(row.budgetExpense) : null, row.budgetUsedPct, BUDGET[row.budgetStatus] || '',
      row.matched, row.differences, row.tallyOnlyLedgers, number(row.gap), HEALTH[row.health] || row.health,
      number(row.excelAmount), number(row.tallyAmount), number(row.netDifference)]);
    [3, 4, 6, 7, 13, 15, 16, 17].forEach(column => { added.getCell(column).numFmt = amount; });
  }
  [14, 12, 14, 14, 10, 14, 14, 14, 20, 10, 10, 14, 16, 16, 16, 16, 18].forEach((width, index) => { if (index) cover.getColumn(index + 1).width = width; });

  sheet(workbook, 'Differences', [
    { header: 'Project', key: 'project', width: 28 },
    { header: 'What is different', key: 'where', width: 34 },
    { header: 'Name in Excel', key: 'excelName', width: 44 },
    { header: 'Name in Tally', key: 'tallyName', width: 44 },
    { header: 'Excel amount', key: 'excel', width: 16, numFmt: amount },
    { header: 'Tally amount', key: 'tally', width: 16, numFmt: amount },
    { header: 'Difference (Excel minus Tally)', key: 'difference', width: 20, numFmt: amount },
    { header: 'Currency', key: 'currency', width: 10 },
  ], report.lines);

  sheet(workbook, 'Progress by upload', [
    { header: 'Excel as on', key: 'date', width: 14 },
    { header: 'File', key: 'file', width: 36 },
    { header: 'Project', key: 'project', width: 28 },
    { header: 'Parties', key: 'parties', width: 10 },
    { header: 'Billed', key: 'billed', width: 16, numFmt: amount },
    { header: 'Paid', key: 'paid', width: 16, numFmt: amount },
    { header: 'Paid %', key: 'paidPct', width: 10 },
    { header: 'Pending', key: 'pending', width: 16, numFmt: amount },
    { header: 'Matched', key: 'matched', width: 10 },
    { header: 'Different', key: 'different', width: 10 },
    { header: 'Only in Tally', key: 'tallyOnly', width: 14 },
    { header: 'Gap', key: 'gap', width: 16, numFmt: amount },
    { header: 'Latest', key: 'latest', width: 10 },
  ], report.history.map(row => ({
    date: row.reportingDate ? String(row.reportingDate).slice(0, 10) : '',
    file: row.fileName, project: row.projectName, parties: row.parties,
    billed: number(row.billed), paid: number(row.paid), paidPct: row.paidPct, pending: number(row.pending),
    matched: row.matched, different: row.differences, tallyOnly: row.tallyOnlyLedgers, gap: number(row.gap),
    latest: row.current ? 'Yes' : '',
  })));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { build, toCsv, toWorkbook, fileName, differenceLines };
