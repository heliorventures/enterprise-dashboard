const ExcelJS = require('exceljs');
const db = require('./db');
const { RULE_PROJECT } = require('./projects/service');
const { csv } = require('./reports');

/**
 * Which Excel parties exist in Tally, and which Tally ledgers are not in the Excel.
 *
 * This looks only at whether each party was matched to a Tally ledger by name (or PAN,
 * GST or a manual link). It does not need a confirmed currency or the same balance
 * date, so it answers "what is missing in Tally" even when amounts cannot be compared.
 * Amounts are shown as stated, side by side, and never subtracted here.
 */
const LIMIT = 10000;
const RESULT = {
  MISSING_IN_TALLY: 'In Excel, missing in Tally',
  POSSIBLE: 'In Excel, only a partial name match in Tally - please check',
  MISSING_IN_EXCEL: 'In Tally, missing in Excel',
  FOUND: 'Found in both',
};

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

/** A name that only partly matches (one contains the other) is not a confirmed match. */
function classify(row) {
  if (!row.tally_ledger_id) return 'MISSING_IN_TALLY';
  return String(row.match_method || '').startsWith('FUZZY') ? 'POSSIBLE' : 'FOUND';
}

async function presence(companyId) {
  return db.readSnapshot(async () => {
    const company = (await db.query('SELECT id,name FROM intel_companies WHERE id=$1', [companyId])).rows[0];
    if (!company) throw fail('Upload and process an Excel file for this company first', 404);
    const excel = (await db.query(
      `SELECT a.id AS account_id,a.account_name,a.level_1_category,COALESCE(p.name,'') AS project_name,
              r.tally_ledger_id,r.tally_ledger_name,r.match_method,r.source_amount,r.tally_amount,l."GroupCategory" AS tally_group
       FROM intel_current_outstanding o
       JOIN intel_accounts a ON a.id=o.account_id
       LEFT JOIN intel_projects p ON p.id=a.project_id
       LEFT JOIN intel_current_reconciliations r ON r.outstanding_id=o.id
       LEFT JOIN "Ledgers" l ON l."LedgerID"=r.tally_ledger_id
       WHERE o.company_id=$1 ORDER BY lower(a.account_name) LIMIT $2`, [companyId, LIMIT + 1])).rows;
    const tallyOnly = (await db.query(
      `SELECT r.tally_ledger_id,r.tally_ledger_name,r.tally_amount,l."GroupCategory" AS tally_group,
              COALESCE(p.name,'') AS project_name
       FROM intel_current_reconciliations r
       LEFT JOIN "Ledgers" l ON l."LedgerID"=r.tally_ledger_id
       LEFT JOIN intel_projects p ON p.id=${RULE_PROJECT('r.tally_ledger_name', 'r.company_id')}
       WHERE r.company_id=$1 AND r.outstanding_id IS NULL
       ORDER BY abs(COALESCE(r.tally_amount,0)) DESC,lower(r.tally_ledger_name) LIMIT $2`, [companyId, LIMIT + 1])).rows;
    if (excel.length > LIMIT || tallyOnly.length > LIMIT) throw fail('This company has more than 10,000 rows in one list', 413);
    const latest = (await db.query(
      `SELECT f.file_name,f.reporting_period_to AS reporting_date
       FROM intel_company_publications p JOIN intel_import_batches b ON b.id=p.import_batch_id
       JOIN intel_import_files f ON f.id=b.import_file_id WHERE p.company_id=$1`, [companyId])).rows[0] || null;
    const groups = { MISSING_IN_TALLY: [], POSSIBLE: [], FOUND: [] };
    for (const row of excel) groups[classify(row)].push(row);
    return {
      company: { id: company.id, name: company.name },
      latestImport: latest,
      summary: {
        excelParties: excel.length,
        found: groups.FOUND.length,
        possible: groups.POSSIBLE.length,
        missingInTally: groups.MISSING_IN_TALLY.length,
        missingInExcel: tallyOnly.length,
      },
      missingInTally: groups.MISSING_IN_TALLY,
      possible: groups.POSSIBLE,
      found: groups.FOUND,
      missingInExcel: tallyOnly,
    };
  });
}

const number = value => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/** One flat list of every difference, for CSV and for the Excel "all differences" view. */
function lines(data) {
  const excelLine = (kind, row) => ({
    result: RESULT[kind], name: row.account_name, tallyName: row.tally_ledger_name || '',
    excel: number(row.source_amount), tally: number(row.tally_amount),
    group: row.level_1_category || '', project: row.project_name || '',
  });
  return [
    ...data.missingInTally.map(row => excelLine('MISSING_IN_TALLY', row)),
    ...data.possible.map(row => excelLine('POSSIBLE', row)),
    ...data.missingInExcel.map(row => ({
      result: RESULT.MISSING_IN_EXCEL, name: '', tallyName: row.tally_ledger_name || '',
      excel: null, tally: number(row.tally_amount), group: row.tally_group || '', project: row.project_name || '',
    })),
  ];
}

function toCsv(data) {
  return csv(lines(data).map(line => ({
    'Result': line.result,
    'Name in Excel': line.name,
    'Name in Tally': line.tallyName,
    'Amount in Excel (as stated)': line.excel ?? '',
    'Balance in Tally': line.tally ?? '',
    'Group': line.group,
    'Project': line.project,
  })));
}

function fileName(company, ext) {
  const slug = String(company.name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'company';
  return `${slug}-missing-in-tally-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

function addSheet(workbook, name, columns, rows) {
  const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(column => ({ header: column.header, key: column.key, width: column.width, style: column.numFmt ? { numFmt: column.numFmt } : {} }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  rows.forEach(row => ws.addRow(row));
  if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

async function toWorkbook(data) {
  const amount = '#,##0.00';
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Helior Finance';
  workbook.created = new Date();
  const { summary } = data;

  const cover = workbook.addWorksheet('Summary');
  cover.getColumn(1).width = 44;
  cover.getColumn(2).width = 60;
  [
    ['What is missing in Tally - Excel outstanding compared with Tally'],
    [],
    ['Company', data.company.name],
    ['Excel file', data.latestImport?.file_name || 'None imported'],
    ['Excel as on', data.latestImport?.reporting_date ? String(data.latestImport.reporting_date).slice(0, 10) : ''],
    ['Report created', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    [],
    ['Parties in the Excel', summary.excelParties],
    ['Found in Tally', summary.found],
    ['Only a partial name match in Tally (please check)', summary.possible],
    ['In Excel, missing in Tally', summary.missingInTally],
    ['In Tally with a balance, missing in Excel', summary.missingInExcel],
    [],
    ['How to read this', 'Parties are matched to Tally ledgers by name, PAN, GST or a manual link. Amounts are shown as stated in each system. The difference in amounts is in the project difference report.'],
  ].forEach(line => cover.addRow(line));
  cover.getRow(1).font = { bold: true, size: 14 };
  cover.getRow(14).getCell(2).alignment = { wrapText: true, vertical: 'top' };

  const excelColumns = [
    { header: 'Name in Excel', key: 'name', width: 52 },
    { header: 'Name in Tally', key: 'tallyName', width: 52 },
    { header: 'Amount in Excel (as stated)', key: 'excel', width: 24, numFmt: amount },
    { header: 'Balance in Tally', key: 'tally', width: 20, numFmt: amount },
    { header: 'Group', key: 'group', width: 24 },
    { header: 'Project', key: 'project', width: 24 },
  ];
  const mapExcel = row => ({
    name: row.account_name, tallyName: row.tally_ledger_name || '', excel: number(row.source_amount),
    tally: number(row.tally_amount), group: row.level_1_category || '', project: row.project_name || '',
  });
  addSheet(workbook, 'Missing in Tally', excelColumns, data.missingInTally.map(mapExcel));
  addSheet(workbook, 'Check these', excelColumns, data.possible.map(mapExcel));
  addSheet(workbook, 'Missing in Excel', [
    { header: 'Name in Tally', key: 'tallyName', width: 52 },
    { header: 'Balance in Tally', key: 'tally', width: 20, numFmt: amount },
    { header: 'Group in Tally', key: 'group', width: 28 },
    { header: 'Project', key: 'project', width: 24 },
  ], data.missingInExcel.map(row => ({
    tallyName: row.tally_ledger_name || '', tally: number(row.tally_amount), group: row.tally_group || '', project: row.project_name || '',
  })));
  addSheet(workbook, 'Found in both', excelColumns, data.found.map(mapExcel));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { presence, lines, toCsv, toWorkbook, fileName, classify, RESULT };
