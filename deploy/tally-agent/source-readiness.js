// Streaming advisory check. The API remains authoritative; raw records are
// never rewritten or dropped because a financial field is absent.
const {field}=require('./source-export');
const {calendarDate}=require('./scope');
const lists=(node,tag)=>(node.content||[]).filter(n=>n&&typeof n==='object'&&n.tag.toUpperCase()===tag&&
  (n.content.some(v=>typeof v==='object'||v.trim())||Object.entries(n.attributes||{}).some(([k,v])=>!['TYPE','ISLIST'].includes(k.toUpperCase())&&v.trim())));
function cents(raw) {
  if(raw===null)return null;
  let value=String(raw).replace(/\u0004/g,'').trim();
  if(!value)return 0n;
  value=value.replace(/^(INR|Rs\.?|₹|USD)\s*/i,'');
  const credit=/\bCr\.?$/i.test(value);
  value=value.replace(/\s*(Dr|Cr)\.?$/i,'').trim();
  if(!/^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,4})?$/.test(value))return null;
  value=value.replaceAll(',','');
  const negative=value.startsWith('-')||credit;
  const [whole,fraction='']=value.replace(/^-/,'').split('.');
  if(whole.length>16||/[1-9]/.test(fraction.slice(2)))return null;
  return (negative?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.slice(0,2).padEnd(2,'0')));
}
function readiness(collection) {
  let errorCount=0,warningCount=0,records=0;const issues=[];
  const addIssue=(ordinal,field,code,message,severity='error')=>{
    if(severity==='error')errorCount++;else warningCount++;
    if(issues.length<20)issues.push({ordinal,field,code,message,severity});
  };
  return {
    add(node,ordinal) {
      records++;
      const money=(node,name)=>{const raw=field(node,name);if(raw===null){addIssue(ordinal,name,name==='CLOSINGBALANCE'?'MISSING_CLOSING_BALANCE':'MISSING_AMOUNT','Required amount was not exported');return null;}
        const value=cents(raw);if(value===null)addIssue(ordinal,name,'INVALID_AMOUNT','Amount cannot be interpreted at reporting precision');return value;};
      if(collection==='COMPANY') {
        if(!String(field(node,'BASECURRENCYNAME')||field(node,'CURRENCYNAME')||'').trim())addIssue(ordinal,'BASECURRENCYNAME','MISSING_CURRENCY','Company base currency was not exported','warning');
        for(const name of ['BOOKSFROM','STARTINGFROM'])if(!field(node,name))addIssue(ordinal,name,'MISSING_PERIOD','Company accounting date was not exported','warning');
      }
      if(collection==='LEDGER')money(node,'CLOSINGBALANCE');
      if(collection==='VOUCHER') {
        const raw=String(field(node,'DATE')||''),date=/^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`:raw;
        if(!calendarDate(date))addIssue(ordinal,'DATE','INVALID_DATE','Voucher date is missing or invalid');
        if(!String(field(node,'GUID')||'').trim())addIssue(ordinal,'GUID','MISSING_GUID','Voucher GUID was not exported');
        if(['ISCANCELLED','ISOPTIONAL'].some(name=>String(field(node,name)).trim().toLowerCase()==='yes'))return;
        if(String(field(node,'AMOUNT')||'').trim())money(node,'AMOUNT');
        const all=lists(node,'ALLLEDGERENTRIES.LIST'),entries=all.length?all:lists(node,'LEDGERENTRIES.LIST');
        if(!entries.length) {
          // Inventory-only vouchers can be legitimate. Flag missing financial
          // capability as a warning when Tally supplies another amount source.
          const inventory=[...lists(node,'ALLINVENTORYENTRIES.LIST'),...lists(node,'INVENTORYENTRIES.LIST')];
          if(field(node,'AMOUNT')===null&&!inventory.length)addIssue(ordinal,'AMOUNT','MISSING_VOUCHER_AMOUNT','Voucher amount and accounting entries were not exported');
          else addIssue(ordinal,'ALLLEDGERENTRIES.LIST','MISSING_POSTINGS','Voucher has no accounting entries; cash-flow coverage requires server validation','warning');
        } else {
          let sum=0n,valid=true;
          for(const entry of entries){const value=money(entry,'AMOUNT');if(value===null)valid=false;else sum+=value;
            if(!String(field(entry,'LEDGERNAME')||'').trim())addIssue(ordinal,'LEDGERNAME','MISSING_LEDGER_NAME','Posting ledger was not exported');}
          if(valid&&sum!==0n)addIssue(ordinal,'AMOUNT','UNBALANCED_POSTINGS','Voucher signed accounting entries do not balance');
        }
      }
    },
    result:()=>({status:errorCount?'blocked':warningCount?'warning':'ready',records,errorCount,warningCount,issues}),
  };
}
function reconciliation(scope) {
  const ledgers=new Map(),movements=new Map();let comparable=!scope;
  const name=node=>String(field(node,'NAME')||'').trim().toLowerCase();
  return {
    add(collection,node,ordinal) {
      if(!comparable)return;
      if(collection==='LEDGER') {
        const id=name(node),opening=cents(field(node,'OPENINGBALANCE')),closing=cents(field(node,'CLOSINGBALANCE'));
        if(!id||ledgers.has(id)||opening===null||closing===null||ledgers.size>=100000){comparable=false;return;}
        ledgers.set(id,{opening,closing,ordinal});
      }
      if(collection==='VOUCHER') {
        if(['ISCANCELLED','ISOPTIONAL'].some(k=>String(field(node,k)).trim().toLowerCase()==='yes'))return;
        const all=lists(node,'ALLLEDGERENTRIES.LIST'),entries=all.length?all:lists(node,'LEDGERENTRIES.LIST');
        if(!entries.length){comparable=false;return;}
        for(const entry of entries) {
          const id=String(field(entry,'LEDGERNAME')||'').trim().toLowerCase(),amount=cents(field(entry,'AMOUNT'));
          if(!id||amount===null||!ledgers.has(id)){comparable=false;return;}
          movements.set(id,(movements.get(id)||0n)+amount);
        }
      }
    },
    result(complete) {
      const issues=[];let warningCount=0;
      if(!complete||!comparable||!ledgers.size){warningCount=1;issues.push({ordinal:0,field:'CLOSINGBALANCE',code:'RECONCILIATION_NOT_COMPARABLE',severity:'warning',
        message:scope?'Period vouchers and full ledger balances have different date scopes; reconciliation is unavailable.':'Complete, interpretable ledger opening/closing balances and postings are required for reconciliation (maximum 100000 ledgers).'});}
      else for(const [id,ledger] of ledgers)if(ledger.opening+(movements.get(id)||0n)!==ledger.closing){warningCount++;
        if(issues.length<20)issues.push({ordinal:ledger.ordinal,field:'CLOSINGBALANCE',code:'LEDGER_RECONCILIATION_DIFFERENCE',severity:'warning',message:'Opening balance plus exported signed movements differs from closing balance. Verify Tally balance dates and voucher coverage.'});}
      return {status:warningCount?'warning':'ready',records:ledgers.size,errorCount:0,warningCount,issues};
    },
  };
}
module.exports={readiness,reconciliation};
