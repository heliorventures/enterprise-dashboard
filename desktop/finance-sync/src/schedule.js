// Times and days use the accountant's Windows clock, like manual period selection.
const FREQUENCIES=Object.freeze([10,15,30,60,120]);
const PERIODS=Object.freeze(['today','current-month']);
const DEFAULT_SCHEDULE=Object.freeze({enabled:false,period:'today',startTime:'11:00',endTime:'17:00',days:[1,2,3,4,5],frequencyMinutes:10,companies:[]});
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
function validateSchedule(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Schedule settings are invalid.');
  const {enabled,period,startTime,endTime,days,frequencyMinutes,companies}=input;
  if(typeof enabled!=='boolean')throw new Error('Schedule settings are invalid.');
  if(!PERIODS.includes(period))throw new Error('Choose Today or Current month for automatic sync.');
  if(typeof startTime!=='string'||typeof endTime!=='string'||!TIME.test(startTime)||!TIME.test(endTime))throw new Error('Choose valid start and end times.');
  if(startTime===endTime)throw new Error('Start and end times must be different.');
  if(!Array.isArray(days)||days.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(days).size!==days.length)throw new Error('Choose valid days for automatic sync.');
  if(!FREQUENCIES.includes(frequencyMinutes))throw new Error('Choose a supported sync frequency.');
  if(!Array.isArray(companies)||companies.length>1000||new Set(companies.map(c=>c?.externalId)).size!==companies.length||
    companies.some(c=>typeof c?.externalId!=='string'||!c.externalId||c.externalId.length>200||typeof c.name!=='string'||!c.name||c.name.length>200))throw new Error('Choose valid companies for automatic sync.');
  if(enabled&&(!days.length||!companies.length))throw new Error('Choose at least one day and one company before turning on automatic sync.');
  return {enabled,period,startTime,endTime,days:[...days].sort((a,b)=>a-b),frequencyMinutes,companies:companies.map(({externalId,name})=>({externalId,name}))};
}
// A window that ends before it starts runs overnight and belongs to its start day.
function inWindow(settings,now) {
  const current=now.getHours()*60+now.getMinutes(),start=minutes(settings.startTime),end=minutes(settings.endTime),day=now.getDay();
  if(start<end)return settings.days.includes(day)&&current>=start&&current<end;
  if(current>=start)return settings.days.includes(day);
  if(current<end)return settings.days.includes((day+6)%7);
  return false;
}
function nextRunAt(settings,lastRunAt,now) {
  if(!settings.enabled||!settings.days.length)return null;
  const last=lastRunAt?Date.parse(lastRunAt):NaN;
  const candidate=new Date(Number.isFinite(last)?Math.max(now.getTime(),last+settings.frequencyMinutes*60000):now.getTime());
  if(inWindow(settings,candidate))return candidate;
  const start=minutes(settings.startTime);
  for(let offset=0;offset<=7;offset++) {
    const day=new Date(candidate.getFullYear(),candidate.getMonth(),candidate.getDate()+offset,Math.floor(start/60),start%60);
    if(day>candidate&&settings.days.includes(day.getDay()))return day;
  }
  return null;
}
module.exports={FREQUENCIES,PERIODS,DEFAULT_SCHEDULE,validateSchedule,inWindow,nextRunAt};
