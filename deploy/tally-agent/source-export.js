const {TallySourceParser}=require('./tally-source-parser');
const {exportXml,xmlCode,xmlReference}=require('./export-diagnostics');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const CATALOG=Object.freeze({COMPANY:'Company',GROUP:'Group',LEDGER:'Ledger',VOUCHERTYPE:'Voucher Type',
  CURRENCY:'Currency',COSTCATEGORY:'Cost Category',COSTCENTRE:'Cost Centre',STOCKGROUP:'Stock Group',
  STOCKCATEGORY:'Stock Category',STOCKITEM:'Stock Item',UNIT:'Unit',GODOWN:'Godown',VOUCHER:'Voucher'});
function fetchList(collection) {
  // Fetch * returns empty tax/date methods and skips calculated Amount plus
  // AllLedgerEntries. Ask for those methods by name on ledgers and vouchers.
  if(collection==='LEDGER') return 'Name,Parent,OpeningBalance,ClosingBalance,*';
  if(collection==='VOUCHER') {
    return 'Date,VoucherTypeName,VoucherNumber,Narration,PartyLedgerName,Amount,MasterID,GUID,IsCancelled,IsOptional,AllLedgerEntries.LedgerName,AllLedgerEntries.Amount,AllLedgerEntries.IsDeemedPositive,LedgerEntries.LedgerName,LedgerEntries.Amount';
  }
  return '*';
}
function nativeMethods(collection) {
  if(collection==='LEDGER') return '<NATIVEMETHOD>OpeningBalance</NATIVEMETHOD><NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>';
  if(collection==='VOUCHER') return '<NATIVEMETHOD>Amount</NATIVEMETHOD>';
  return '';
}
function request(collection,company) {
  if(!Object.hasOwn(CATALOG,collection)) throw new Error('Unknown source collection');
  // Fetch * asks for methods and subcollections, not just dashboard fields.
  // TDL can only return methods exposed by the installed version/customization.
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinanceSourceArchive</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escape(company)}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">19000101</SVFROMDATE><SVTODATE TYPE="Date">99991231</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinanceSourceArchive" ISMODIFY="No"><TYPE>${CATALOG[collection]}</TYPE><FETCH>${fetchList(collection)}</FETCH>${nativeMethods(collection)}</COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
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
      // Do not retain/log arbitrary server error contents.
      node.text=(node.text+text).slice(0,1000);
    }
  };
  xml.on('text',add);xml.on('cdata',add);
  xml.on('closetag',()=>{
    const node=stack.pop();
    if(recordDepth<0&&(['LINEERROR','ERROR'].includes(node.name)||(node.name==='STATUS'&&node.text.trim()==='0')||
      (node.name==='ERRORS'&&node.text.trim()!==''&&node.text.trim()!=='0'))) reject('Tally reported a source export error');
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
async function extract(config,collection,company,onRecord) {
  return exportXml(config,{collection,company,body:request(collection,company),phase:'source_capture',
    createParser:wrap=>parser(collection,wrap(onRecord))});
}
module.exports={CATALOG,request,parser,field,extract,fetchList};
