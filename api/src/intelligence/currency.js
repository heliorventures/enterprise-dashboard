const {currencyCode} = require('../reportCurrency');

function basis(inputs) {
  const source_currency = currencyCode(inputs?.analysis?.currency);
  const tally_currency = inputs?.reference?.uniformCurrency === true ? currencyCode(inputs.reference.currency) : null;
  return {source_currency,tally_currency,currency:source_currency && source_currency===tally_currency ? source_currency : null};
}

function aggregateBasis(inputs) {
  const currencies=inputs.map(input=>basis(input).source_currency);
  const currency=currencies.length && currencies.every(code=>code && code===currencies[0]) ? currencies[0] : null;
  return {currency,monetaryAvailable:Boolean(currency),currencyMessage:currency ? null
    : 'Monetary totals unavailable: select one currency and declare Currency: ISO code in each workbook before reprocessing. No conversion is applied.'};
}

async function currentBasis(database,companyId) {
  const result=await database.query(`SELECT p.company_id,b.frozen_inputs FROM intel_company_publications p
    JOIN intel_import_batches b ON b.id=p.import_batch_id WHERE ($1::uuid IS NULL OR p.company_id=$1)`,[companyId || null]);
  return {...aggregateBasis(result.rows.map(row=>row.frozen_inputs)),companies:new Map(result.rows.map(row=>[row.company_id,basis(row.frozen_inputs)]))};
}

async function rowsWithCurrency(database,rows) {
  const ids=[...new Set(rows.map(row=>row.import_batch_id).filter(Boolean))];
  if (!ids.length) return rows.map(row=>({...row,source_currency:null,tally_currency:null,currency:null}));
  const batches=await database.query('SELECT id,frozen_inputs FROM intel_import_batches WHERE id=ANY($1::uuid[])',[ids]);
  const byId=new Map(batches.rows.map(row=>[row.id,basis(row.frozen_inputs)]));
  const references=new Map(batches.rows.map(row=>[row.id,row.frozen_inputs?.reference]));
  return rows.map(row=>{
    const currencies={...(byId.get(row.import_batch_id) || basis(null))};
    const ledger=references.get(row.import_batch_id)?.ledgers?.find(ledger=>Number(ledger.id)===Number(row.tally_ledger_id));
    currencies.tally_currency=currencyCode(ledger?.currency) || currencies.tally_currency;
    const comparisonRow='tally_amount' in row || 'difference' in row;
    return {...row,...currencies,...(comparisonRow && !currencies.currency ? {
      difference:null,difference_pct:null,comparison_available:false,
      ...('status' in row ? {status:'COMPARISON_UNAVAILABLE'} : {}),
      ...('recon_status' in row ? {recon_status:'COMPARISON_UNAVAILABLE'} : {}),
    } : {})};
  });
}

function reconciliationSummary(rows,inputs) {
  const {currency}=basis(inputs);
  if (!currency) return rows.length ? [{status:'COMPARISON_UNAVAILABLE',count:rows.reduce((total,row)=>total+Number(row.count),0),difference:null,currency:null}] : [];
  return rows.map(row=>({...row,currency,difference:row.status==='COMPARISON_UNAVAILABLE' ? null : row.difference}));
}

function publicBatch(batch) {
  if (!batch) return batch;
  const currency=basis(batch.frozen_inputs).source_currency;
  return {...batch,currency,...(!currency ? {source_total_debit:null,source_total_credit:null,
    calculated_total_debit:null,calculated_total_credit:null} : {})};
}

module.exports={basis,aggregateBasis,currentBasis,rowsWithCurrency,reconciliationSummary,publicBatch};
