// Synthetic wire fixture. Deliberately independent of the production XML builder/parser.
const http = require('node:http');
const {EventEmitter} = require('node:events');
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const unescape = text => text.replace(/&(?:amp|lt|gt|quot|apos);/g, c => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[c]));
const envelope = rows => `<ENVELOPE><BODY><DATA><COLLECTION>${rows}</COLLECTION></DATA></BODY></ENVELOPE>`;
class SyntheticTally extends EventEmitter {
  constructor(companies) {
    super(); this.companies=companies; this.requests=[]; this.active=0; this.maxActive=0; this.fault=null;
    this.server=http.createServer((req,res)=>{
      let body=''; req.setEncoding('utf8'); req.on('data',s=>{body+=s;});
      req.on('end',()=>this.reply(body,res));
    });
  }
  async listen() {await new Promise(resolve=>this.server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${this.server.address().port}`;}
  close() {this.server.closeAllConnections();return new Promise(resolve=>this.server.close(resolve));}
  reply(body,res) {
    const types=[...body.matchAll(/<TYPE>([^<]+)<\/TYPE>/g)];
    const rawType=types.at(-1)?.[1]||'';
    const type=rawType.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
    const company=unescape(body.match(/<SVCURRENTCOMPANY>([^<]*)<\/SVCURRENTCOMPANY>/)?.[1]||'');
    const from=body.match(/<SVFROMDATE[^>]*>(\d{8})<\/SVFROMDATE>/)?.[1];
    const to=body.match(/<SVTODATE[^>]*>(\d{8})<\/SVTODATE>/)?.[1];
    const entry={type,company,from,to,requestKind:body.match(/<TALLYREQUEST>([^<]+)<\/TALLYREQUEST>/)?.[1],dateOnly:body.includes('<FETCH>Date</FETCH>'),started:performance.now(),finished:null};
    this.requests.push(entry); this.active++;this.maxActive=Math.max(this.maxActive,this.active);
    let closed=false;
    const done=()=>{if(!closed){closed=true;entry.finished=performance.now();this.active--;}};
    res.once('finish',done);res.once('close',done);this.emit('request',entry);
    const fault=this.fault && (!this.fault.type||this.fault.type===type)?this.fault:null;
    if(fault?.kind==='hold')return;
    if(fault?.kind==='disconnect'){res.destroy();return;}
    if(fault?.kind==='malformed'){res.end('<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER>');return;}
    if(fault?.kind==='http'){res.writeHead(503);res.end('Synthetic Tally unavailable');return;}
    const selected=company?this.companies.filter(c=>c.name===company):this.companies;
    let rows='';
    if(type==='Company')rows=selected.map(c=>`<COMPANY NAME="${escape(c.name)}"><NAME>${escape(c.name)}</NAME><GUID>${escape(c.id)}</GUID><LASTALTERID>1</LASTALTERID><LASTVCHID>1</LASTVCHID></COMPANY>`).join('');
    else if(type==='Group')rows=['Sales Accounts','Bank Accounts','Indirect Expenses'].map(name=>`<GROUP NAME="${name}"><NAME>${name}</NAME><PARENT>Primary</PARENT></GROUP>`).join('');
    else if(type==='Ledger')rows=selected.flatMap(c=>c.ledgers||[]).map(l=>`<LEDGER NAME="${escape(l.name)}"><NAME>${escape(l.name)}</NAME><PARENT>${escape(l.parent)}</PARENT><OPENINGBALANCE>0.00</OPENINGBALANCE><CLOSINGBALANCE>${l.balance}</CLOSINGBALANCE></LEDGER>`).join('');
    else if(type==='Voucher')rows=selected.flatMap(c=>c.vouchers).filter(v=>(!from||v.date>=from)&&(!to||v.date<=to)).map(v=>entry.dateOnly?`<VOUCHER><DATE>${v.date}</DATE></VOUCHER>`:`<VOUCHER><GUID>${escape(v.id)}</GUID><DATE>${v.date}</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${escape(v.id)}</VOUCHERNUMBER><AMOUNT>${escape(v.amount)}</AMOUNT><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>${escape(v.amount)}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Bank</LEDGERNAME><AMOUNT>-${escape(v.amount)}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`).join('');
    const reply=()=>{if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/xml'});res.end(envelope(rows));}};
    if(fault?.kind==='slow'){const timer=setTimeout(reply,fault.delayMs);res.once('close',()=>clearTimeout(timer));}else reply();
  }
}
module.exports={SyntheticTally};
