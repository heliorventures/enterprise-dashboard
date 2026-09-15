function calendarDate(value) {
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
function validateScope(scope) {
  if(!scope||scope.kind!=='period'||!calendarDate(scope.from)||!calendarDate(scope.to)||scope.from>scope.to)throw new Error('Invalid period dates');
  return {kind:'period',from:scope.from,to:scope.to};
}
function *dateWindows(scope,days) {
  validateScope(scope);
  if(!Number.isInteger(days)||days<1||days>7)throw new Error('Invalid voucherWindowDays');
  const end=Date.parse(scope.to);
  for(let start=Date.parse(scope.from);start<=end;) {
    const last=Math.min(end,start+(days-1)*86400000);
    yield {kind:'period',from:new Date(start).toISOString().slice(0,10),to:new Date(last).toISOString().slice(0,10)};
    start=last+86400000;
  }
}
module.exports={calendarDate,validateScope,dateWindows};
