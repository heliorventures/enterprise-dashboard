const decimal = require('../transform/decimal');
const { transformRow } = require('../transform/normalize');

function stage(analysis, columns, required, rules) {
  const targets = new Set(columns.map(column => column.target).filter(Boolean));
  const missingRequired = required.filter(field => !targets.has(field.field_key));
  const duplicateTargets = columns.filter((column,index) => column.target && columns.findIndex(other=>other.target===column.target)!==index);
  const names = new Set();
  const staged = analysis.rows.map(row => {
    const result = row.rowType === 'DETAIL' ? transformRow(row.raw, columns) : { mapped: {}, errors: [] };
    const errors = [...result.errors];
    if (row.rowType === 'DETAIL') {
      if (!result.mapped.account_name) errors.push({ code: 'REQUIRED_FIELD', field: 'account_name' });
      const name = String(result.mapped.account_name || '').trim().toLowerCase();
      if (name && names.has(name)) errors.push({ code: 'DUPLICATE_ACCOUNT', field: 'account_name' });
      names.add(name);
      if (rules.gst_required?.required && !result.mapped.gst_number) errors.push({ code: 'REQUIRED_FIELD', field: 'gst_number' });
    }
    const status = errors.some(error => error.code.startsWith('INVALID') || ['REQUIRED_FIELD','DUPLICATE_ACCOUNT'].includes(error.code))
      ? 'ERROR' : errors.length ? 'WARNING' : 'OK';
    return { row, mapped: result.mapped, errors, status };
  });
  const details = staged.filter(item => item.row.rowType === 'DETAIL');
  const failed = details.filter(item => item.status === 'ERROR').length;
  const validation = { total: details.length, valid: details.length - failed, warnings: details.filter(item => item.status === 'WARNING').length,
    errors: failed + missingRequired.length + duplicateTargets.length, canProcess: details.length > 0 && !failed && !missingRequired.length && !duplicateTargets.length,
    missingRequired, unmappedColumns: columns.filter(column => column.unmapped).map(column => column.canonical),
    issues: staged.filter(item => item.errors.length).map(item => ({ row: item.row.sourceRowNumber, account: item.mapped.account_name, errors: item.errors })).slice(0,100) };
  validation.issues.push(...duplicateTargets.map(column=>({row:null,errors:[{code:'DUPLICATE_TARGET',field:column.target}]})));
  const total = analysis.rows.find(row => row.rowType === 'TOTAL');
  const totals = { sourceDebit: null, sourceCredit: null,
    calcDebit: decimal.sum(details.map(item => item.mapped.pending_bill_debit || 0)),
    calcCredit: decimal.sum(details.map(item => item.mapped.pending_bill_credit || 0)) };
  if (total) {
    const transformed = transformRow(total.raw, columns);
    if (transformed.errors.some(error => error.code === 'INVALID_DECIMAL')) {
      validation.errors += 1; validation.canProcess = false;
      validation.issues.push({ row:total.sourceRowNumber, errors:transformed.errors });
    }
    totals.sourceDebit = transformed.mapped.pending_bill_debit ?? '0.00';
    totals.sourceCredit = transformed.mapped.pending_bill_credit ?? '0.00';
  }
  totals.totalStatus = !total ? 'NO_SOURCE_TOTAL' : totals.sourceDebit === totals.calcDebit && totals.sourceCredit === totals.calcCredit ? 'MATCHED' : 'SOURCE_TOTAL_MISMATCH';
  if (totals.totalStatus === 'SOURCE_TOTAL_MISMATCH' && rules.fail_import_on_total_mismatch?.enabled) {
    validation.errors += 1; validation.canProcess = false;
    validation.issues.push({ row:total.sourceRowNumber, errors:[{code:'SOURCE_TOTAL_MISMATCH'}] });
  }
  return { staged, validation, totals };
}

function shouldPublish(previousDate, incomingDate) {
  if (!previousDate) return true;
  return Boolean(incomingDate && incomingDate >= previousDate);
}

module.exports = { stage, shouldPublish };
