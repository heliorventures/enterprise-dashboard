const {TallySourceParser}=require('./tally-source-parser');
const {exportXml,xmlCode,xmlReference}=require('./export-diagnostics');
const {setTimeout:delay}=require('node:timers/promises');
const {calendarDate,dateWindows}=require('./scope');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const CATALOG=Object.freeze({COMPANY:'Company',GROUP:'Group',LEDGER:'Ledger',VOUCHERTYPE:'Voucher Type',
  CURRENCY:'Currency',COSTCATEGORY:'Cost Category',COSTCENTRE:'Cost Centre',STOCKGROUP:'Stock Group',
  STOCKCATEGORY:'Stock Category',STOCKITEM:'Stock Item',UNIT:'Unit',GODOWN:'Godown',VOUCHER:'Voucher'});
function fetchList(collection) {
  // Fetch * returns empty tax/date methods and skips calculated Amount plus
  // AllLedgerEntries. Ask for those methods by name on ledgers and vouchers.
  if(collection==='COMPANY') return 'Name,GUID,CurrencyName,BaseCurrencyName,BooksFrom,StartingFrom,LastAlterID,LastVchID,*';
  if(collection==='LEDGER') return 'Name,Parent,OpeningBalance,ClosingBalance,CurrencyName,IsBillWiseOn,BillCreditPeriod,BillAllocations.Name,BillAllocations.BillDate,BillAllocations.OpeningBalance,BillAllocations.BillCreditPeriod,*';
  if(collection==='VOUCHER') {
    const fields=['Date','VoucherTypeName','VoucherNumber','Narration','PartyLedgerName','Amount','MasterID','GUID','IsCancelled','IsOptional'];
    for(const entries of ['AllLedgerEntries','LedgerEntries']) {
      for(const method of ['Name','BillType','Amount','BillCreditPeriod']) fields.push(`${entries}.BillAllocations.${method}`);
      for(const method of ['LedgerName','Amount','IsDeemedPositive','CategoryAllocations.Category','CategoryAllocations.CostCentreAllocations.Name','CategoryAllocations.CostCentreAllocations.Amount','CostCentreAllocations.Name','CostCentreAllocations.Amount']) fields.push(`${entries}.${method}`);
    }
    for(const entries of ['AllInventoryEntries','InventoryEntries']) {
      for(const method of ['StockItemName','ActualQty','Amount','GodownName','BatchAllocations.GodownName','BatchAllocations.ActualQty','BatchAllocations.Amount']) fields.push(`${entries}.${method}`);
    }
    return [...fields,'*'].join(',');
  }
  return '*';
}
function nativeMethods(collection) {
  if(collection==='LEDGER') return '<NATIVEMETHOD>OpeningBalance</NATIVEMETHOD><NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>';
  if(collection==='VOUCHER') return '<NATIVEMETHOD>Amount</NATIVEMETHOD>';
  return '';
}
function request(collection,company,scope,onlyDate=false) {
  if(!Object.hasOwn(CATALOG,collection)) throw new Error('Unknown source collection');
  if(onlyDate&&collection!=='VOUCHER')throw new Error('Date discovery requires vouchers');
  if(scope)require('./scope').validateScope(scope);
  const period=scope&&collection==='VOUCHER';
  const from=period?scope.from.replaceAll('-',''):'19010101',to=period?scope.to.replaceAll('-',''):'99991231';
  const filter=period?'<FILTER>FinancePeriodFilter</FILTER>':'';
  const formula=period?'<SYSTEM TYPE="Formulae" NAME="FinancePeriodFilter">$Date &gt;= ##SVFromDate AND $Date &lt;= ##SVToDate</SYSTEM>':'';
  // Fetch * asks for methods and subcollections, not just dashboard fields.
  // TDL can only return methods exposed by the installed version/customization.
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinanceSourceArchive</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escape(company)}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">${from}</SVFROMDATE><SVTODATE TYPE="Date">${to}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinanceSourceArchive" ISMODIFY="No"><TYPE>${CATALOG[collection]}</TYPE><FETCH>${onlyDate?'Date':fetchList(collection)}</FETCH>${onlyDate?'':nativeMethods(collection)}${filter}</COLLECTION>${formula}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}
// Version 1 JSON representation preserves names, attributes, text and ordered
// child lists. It never coerces an amount/date, trims data or collapses repeats.
// XML entity spelling/CDATA boundaries are not retained; their decoded text is.
function parser(collection,onRecord) {
  const xml=new TallySourceParser(),stack=[];
  let recordDepth=-1,recordBytes=0,hasCollection=false;
  const diagnostics=()=>({xmlLine:xml.line,xmlColumn:xml.column,xmlPosition:xml.position,
    xmlPath:'/'+stack.map(n=>n.name).join('/'),
    ...xmlReference(xml),tallyControlCharacters:{...xml.tallyControls}});
  const reject=(message,code='SOURCE_XML_ERROR')=>{throw Object.assign(new Error(message),{code,xmlDiagnostic:diagnostics()});};
  xml.on('doctype',()=>reject('Source XML DTD is not supported'));
  xml.on('error',error=>reject('Source response is not complete valid XML',xmlCode(error)));
  xml.on('opentag',node=>{
    if(stack.length>=64) reject('Source XML depth limit exceeded');
    const name=node.name.toUpperCase(),parent=stack.map(n=>n.name).join('/');
    if(!stack.length&&name!=='ENVELOPE') reject('Source response is not a Tally envelope');
    if(name==='COLLECTION'&&parent==='ENVELOPE/BODY/DATA') hasCollection=true;
    if(parent==='ENVELOPE/BODY/DATA/COLLECTION') {
      if(name!==collection) reject('Unexpected record in source collection');
      recordDepth=stack.length;recordBytes=0;
    }
    const attributes=Object.fromEntries(Object.entries(node.attributes));
    const entry={name,tag:node.name,attributes,content:[],text:''};
    if(recordDepth>=0) {
      recordBytes+=Buffer.byteLength(JSON.stringify({tag:node.name,attributes}))+20;
      if(recordBytes>2*1024**2) reject('Source record exceeds 2 MiB');
    }
    stack.push(entry);
  });
  const add=text=>{
    if(!stack.length) return;
    const node=stack[stack.length-1];
    if(recordDepth>=0) {
      recordBytes+=Buffer.byteLength(JSON.stringify(text))+4;
      if(recordBytes>2*1024**2) reject('Source record exceeds 2 MiB');
      const last=node.content.length-1;
      if(typeof node.content[last]==='string') node.content[last]+=text;
      else node.content.push(text);
    } else if(['STATUS','LINEERROR','ERROR','ERRORS'].includes(node.name)) {
      // Only server error elements outside business records are diagnostics.
      node.text=(node.text+text).slice(0,2000);
    }
  };
  xml.on('text',add);xml.on('cdata',add);
  xml.on('closetag',()=>{
    const node=stack.pop();
    if(recordDepth<0&&(['LINEERROR','ERROR'].includes(node.name)||(node.name==='STATUS'&&node.text.trim()==='0')||
      (node.name==='ERRORS'&&node.text.trim()!==''&&node.text.trim()!=='0'))) {
      throw Object.assign(new Error('Tally reported a source export error'),{code:'TALLY_SOURCE_ERROR',
        tallyMessage:require('./export-diagnostics').safeText(node.text),xmlDiagnostic:{...diagnostics(),xmlPath:'/'+[...stack.map(n=>n.name),node.name].join('/')}});
    }
    if(recordDepth>=0) {
      const value={tag:node.tag,attributes:node.attributes,content:node.content};
      if(recordDepth===stack.length) {onRecord(value);recordDepth=-1;}
      else stack[stack.length-1].content.push(value);
    }
  });
  return {diagnostics,write:value=>xml.write(value),close:()=>{xml.close();if(!hasCollection) reject('Source data collection missing','SOURCE_COLLECTION_MISSING');}};
}
function field(node,name) {
  const children=node.content.filter(c=>typeof c==='object'&&c.tag.toUpperCase()===name);
  if(children.length===1&&children[0].content.every(c=>typeof c==='string')) return children[0].content.join('');
  if(children.length) return null; // Never guess an index when indexing identity.
  const key=Object.keys(node.attributes).find(k=>k.toUpperCase()===name);
  return key===undefined ? null : node.attributes[key];
}
async function pause(config) {
  config.signal?.throwIfAborted();
  const milliseconds=config.requestPauseMs??0;
  if(!Number.isInteger(milliseconds)||milliseconds<0||milliseconds>60000)throw new Error('Invalid requestPauseMs');
  if(milliseconds) {
    config.exportLog?.({event:'tally_request_pause',durationMs:milliseconds});
    await delay(milliseconds,undefined,{signal:config.signal});
  }
  config.signal?.throwIfAborted();
}
function voucherDate(payload) {
  const raw=field(payload,'DATE');
  const date=typeof raw==='string'&&/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw;
  if(!calendarDate(date)||date<'1901-01-01')throw new Error('BATCH_VOUCHER_DATE_INVALID');
  return date;
}
async function extractOnce(config,collection,company,onRecord,onlyDate=false) {
  await pause(config);
  return exportXml(config,{collection,company,body:request(collection,company,config.scope,onlyDate),phase:onlyDate?'voucher_date_discovery':'source_capture',
    createParser:wrap=>parser(collection,wrap(onRecord))});
}
async function extract(config,collection,company,onRecord) {
  if(config.voucherWindowDays===undefined||collection!=='VOUCHER')return extractOnce(config,collection,company,onRecord);
  if(!Number.isInteger(config.voucherWindowDays)||config.voucherWindowDays<1||config.voucherWindowDays>7)throw new Error('Invalid voucherWindowDays');
  let windows,bytes=0,discoveredCount=null,detailedCount=0;
  if(!config.scope) {
    const populated=new Map(),origin=Date.parse('1901-01-01'),end=Date.parse('9999-12-31'),width=config.voucherWindowDays*86400000;
    discoveredCount=0;
    // Stream only dates. Retain populated fixed buckets rather than scanning
    // empty years between historical and future-dated vouchers.
    bytes+=await extractOnce(config,collection,company,payload=>{
      const date=voucherDate(payload);
      const start=origin+Math.floor((Date.parse(date)-origin)/width)*width;
      populated.set(start,(populated.get(start)||0)+1);
      if(++discoveredCount>5000000)throw new Error('Source snapshot exceeds capture limits');
    },true);
    windows=[...populated].sort(([a],[b])=>a-b).map(([start,count])=>({kind:'period',
      from:new Date(start).toISOString().slice(0,10),to:new Date(Math.min(end,start+width-86400000)).toISOString().slice(0,10),count}));
  } else windows=dateWindows(config.scope,config.voucherWindowDays);
  for(const window of windows) {
    let windowCount=0;
    config.signal?.throwIfAborted();
    config.exportLog?.({event:'source_voucher_window_started',company,collection,from:window.from,to:window.to});
    bytes+=await extractOnce({...config,scope:window},collection,company,payload=>{
      const date=voucherDate(payload),guid=field(payload,'GUID');
      if(date<window.from||date>window.to)throw new Error('BATCH_VOUCHER_DATE_INVALID');
      if(typeof guid!=='string'||!guid||guid!==guid.trim()||guid.length>2000)throw new Error('BATCH_VOUCHER_GUID_REQUIRED');
      windowCount++;detailedCount++;
      onRecord(payload);
    });
    if(window.count!==undefined&&windowCount!==window.count)throw new Error('BATCH_VOUCHER_COUNT_MISMATCH');
    config.exportLog?.({event:'source_voucher_window_finished',company,collection,from:window.from,to:window.to});
  }
  if(discoveredCount!==null&&detailedCount!==discoveredCount)throw new Error('BATCH_VOUCHER_COUNT_MISMATCH');
  return bytes;
}
module.exports={CATALOG,request,parser,field,extract,fetchList,pause};
