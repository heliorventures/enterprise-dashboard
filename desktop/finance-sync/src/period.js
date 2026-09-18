// Resolve once on click using the accountant's Windows calendar, not UTC.
function scopeFor(mode='full',now=new Date()) {
  const day=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if(mode&&typeof mode==='object'&&mode.kind==='custom') {
    const valid=value=>typeof value==='string'&&/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value)&&value>='1901-01';
    if(!valid(mode.fromMonth)||!valid(mode.toMonth)||mode.fromMonth>mode.toMonth)throw new Error('Choose valid start and end months, with the start no later than the end.');
    const [year,month]=mode.toMonth.split('-').map(Number);
    const last=new Date(year,month,0).getDate();
    return {kind:'period',from:`${mode.fromMonth}-01`,to:`${mode.toMonth}-${last}`};
  }
  if(mode==='full')return undefined;
  if(mode==='today')return {kind:'period',from:day(now),to:day(now)};
  if(mode==='current-month')return {kind:'period',from:day(new Date(now.getFullYear(),now.getMonth(),1)),to:day(new Date(now.getFullYear(),now.getMonth()+1,0))};
  if(mode==='last-month')return {kind:'period',from:day(new Date(now.getFullYear(),now.getMonth()-1,1)),to:day(new Date(now.getFullYear(),now.getMonth(),0))};
  throw new Error('Choose a valid sync period');
}
module.exports={scopeFor};
