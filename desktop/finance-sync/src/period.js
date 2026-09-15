// Resolve once on click using the accountant's Windows calendar, not UTC.
function scopeFor(mode='full',now=new Date()) {
  const day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if(mode==='full')return undefined;
  if(mode==='today')return {kind:'period',from:day(now),to:day(now)};
  if(mode==='current-month')return {kind:'period',from:day(new Date(now.getFullYear(),now.getMonth(),1)),to:day(new Date(now.getFullYear(),now.getMonth()+1,0))};
  if(mode==='last-month')return {kind:'period',from:day(new Date(now.getFullYear(),now.getMonth()-1,1)),to:day(new Date(now.getFullYear(),now.getMonth(),0))};
  throw new Error('Choose a valid sync period');
}
module.exports={scopeFor};
