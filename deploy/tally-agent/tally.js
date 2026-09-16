const { SaxesParser } = require('saxes');
const {exportXml,xmlCode,xmlReference}=require('./export-diagnostics');
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
function amount(value) {
  const raw = String(value ?? '').trim();
  // Do not remove arbitrary punctuation or silently convert missing values to zero.
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw new Error('Unsupported Tally amount format');
  const normalized = raw.replace(/,/g, '');
  if (!/^-?\d{1,16}(\.\d{1,2})?$/.test(normalized)) throw new Error('Amount exceeds API precision');
  return normalized;
}
function date(value) {
  const raw = String(value ?? '');
  if (!/^\d{8}$/.test(raw)) throw new Error('Invalid Tally date');
  const result = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result) throw new Error('Invalid Tally date');
  return result;
}
function required(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${label}`);
  return value.trim();
}
function parseXml(type, onRecord) {
  const parser = new SaxesParser();
  const stack = [];
  let recordDepth = -1, recordBytes = 0, collection = false, root = false;
  parser.on('doctype', () => { throw new Error('XML DTD is not allowed'); });
  const diagnostics=()=>({xmlLine:parser.line,xmlColumn:parser.column,xmlPosition:parser.position,
    xmlPath:'/'+stack.map(n=>n.name).join('/'),
    ...xmlReference(parser)});
  parser.on('error', error => { throw Object.assign(new Error('Malformed Tally XML'),{code:xmlCode(error),xmlDiagnostic:diagnostics()}); });
  parser.on('opentag', node => {
    if (stack.length >= 64) throw new Error('Tally XML nesting exceeds supported depth');
    const name = node.name.toUpperCase();
    if (!stack.length) { if (name !== 'ENVELOPE') throw new Error('Not a Tally envelope'); root = true; }
    // HEADER/VERSION can contain COMPANY counters. Only DATA collection members
    // are records; response descriptions and nested fields are not discoveries.
    const parentPath = stack.map(entry => entry.name).join('/');
    if (name === 'COLLECTION' && parentPath === 'ENVELOPE/BODY/DATA') collection = true;
    const isRecord = name === type && recordDepth === -1 && parentPath === 'ENVELOPE/BODY/DATA/COLLECTION';
    if (isRecord) { recordDepth = stack.length; recordBytes = 0; }
    const attributes = Object.fromEntries(Object.entries(node.attributes).map(([k,v]) => [k.toUpperCase(),v]));
    // TYPE="String", TYPE="Date", etc. describe a leaf's text, not its value.
    // Retain record attributes separately so NAME attributes and NAME elements
    // can be reconciled without confusing repeated list entries with metadata.
    stack.push({ name, text: '', attributes, isRecord, children: new Set(),
      value: Object.assign(Object.create(null), isRecord ? attributes : {}) });
  });
  const addText = text => {
    if (!stack.length) return;
    const node = stack[stack.length-1];
    node.text += text;
    if (recordDepth >= 0) recordBytes += Buffer.byteLength(text);
    if (node.text.length > 1024*1024 || recordBytes > 2*1024*1024) throw new Error('Tally record exceeds supported size');
  };
  parser.on('text', addText);
  parser.on('cdata', addText);
  parser.on('closetag', () => {
    const node = stack.pop();
    if (['LINEERROR','ERROR'].includes(node.name) || (node.name === 'STATUS' && node.text.trim() === '0') ||
        (node.name === 'ERRORS' && node.text.trim() !== '' && node.text.trim() !== '0')) throw Object.assign(new Error('Tally reported an export error'),
          {code:'TALLY_SOURCE_ERROR',tallyMessage:require('./export-diagnostics').safeText(node.text),xmlDiagnostic:{...diagnostics(),xmlPath:'/'+[...stack.map(n=>n.name),node.name].join('/')}});
    if (recordDepth === stack.length) {
      onRecord(node.value);
      recordDepth = -1;
    } else if (recordDepth >= 0) {
      const value = node.children.size ? node.value : node.text.trim();
      const parentNode = stack[stack.length-1];
      const parent = parentNode.value;
      if (parentNode.isRecord && Object.hasOwn(parentNode.attributes, node.name) && !parentNode.children.has(node.name)) {
        if (typeof value !== 'string' || parentNode.attributes[node.name].trim() !== value) {
          throw new Error(`Conflicting Tally ${node.name} attribute and element`);
        }
        parent[node.name] = value;
      } else if (!parentNode.children.has(node.name)) parent[node.name] = value;
      else if (Array.isArray(parent[node.name])) parent[node.name].push(value);
      else parent[node.name] = [parent[node.name], value];
      parentNode.children.add(node.name);
    }
  });
  return {
    diagnostics,
    write(text) { parser.write(text); return this; },
    close() { parser.close(); if (!root || !collection) throw new Error('Tally collection missing; refusing an empty snapshot'); }
  };
}
function request(type, company) {
  const fields = { COMPANY:'Name,GUID,BooksFrom,LastAlterID,LastVchID', LEDGER:'Name,Parent,ClosingBalance',
    VOUCHER:'Date,VoucherTypeName,VoucherNumber,Narration,Amount,PartyLedgerName,IsCancelled,IsOptional,AllLedgerEntries.*' };
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinanceAgent</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${company ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>` : ''}<SVFROMDATE TYPE="Date">19000101</SVFROMDATE><SVTODATE TYPE="Date">99991231</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinanceAgent" ISMODIFY="No"><TYPE>${type}</TYPE><FETCH>${fields[type]}</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}
async function extract(config, type, company, onRecord) {
  return exportXml(config,{collection:type,company,body:request(type,company),phase:config.exportPhase||'discovery',
    createParser:wrap=>parseXml(type,wrap(onRecord))});
}
function ledger(row) {
  // Tally emits an explicit empty Amount for a zero closing balance. Scope this
  // convention to this field: a missing value still indicates an invalid export.
  const balance = row.CLOSINGBALANCE === '' ? '0.00' : amount(row.CLOSINGBALANCE);
  return { name:required(row.NAME,200,'ledger name'), group:required(row.PARENT,100,'ledger group'), balance };
}
function voucher(row) {
  if (row.ISCANCELLED === 'Yes' || row.ISOPTIONAL === 'Yes') return null;
  let total;
  if (typeof row.AMOUNT === 'string' && row.AMOUNT !== '') total = amount(row.AMOUNT);
  else {
    // Voucher totals must not sum both sides (which net to zero).
    const entries = row['ALLLEDGERENTRIES.LIST'] || row['LEDGERENTRIES.LIST'];
    if (!entries) throw new Error('Voucher has neither amount nor accounting entries');
    let credit = 0n, debit = 0n;
    for (const entry of (Array.isArray(entries) ? entries : [entries])) {
      const raw = amount(entry.AMOUNT), negative = raw.startsWith('-');
      const [whole, fraction=''] = raw.replace('-', '').split('.');
      const cents = BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0'));
      if (negative) debit += cents; else credit += cents;
    }
    if (credit !== debit) throw new Error('Voucher accounting entries do not balance');
    total = amount(`${credit/100n}.${String(credit%100n).padStart(2,'0')}`);
  }
  const result = { date:date(row.DATE), type:required(row.VOUCHERTYPENAME,80,'voucher type'), amount:total, narration:'' };
  for (const [source,target,max] of [['VOUCHERNUMBER','number',80],['PARTYLEDGERNAME','party',200],['NARRATION','narration',400]]) {
    if (row[source]) result[target] = required(row[source],max,target);
  }
  return result;
}
module.exports = { amount, date, required, parseXml, extract, ledger, voucher };
