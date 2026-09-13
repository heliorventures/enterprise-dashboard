const fs=require('node:fs');
const path=require('node:path');
function validateSelection(ids,companies) {
  if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!companies.some(c=>c.externalId===id)))throw new Error('Check the company list again and select at least one company.');
  return [...ids];
}
function pendingSummary(state) {
  const box=path.join(state,'source-outbox'),companies=[];let count=0,damaged=0;
  if(!fs.existsSync(box))return {count,damaged,companies};
  for(const id of fs.readdirSync(box)) {
    if(!/^[a-f0-9-]{36}$/.test(id))continue;
    const file=path.join(box,id,'manifest.json');
    if(!fs.existsSync(file))continue;
    try {
      const m=JSON.parse(fs.readFileSync(file,'utf8'));
      if(typeof m.company?.externalId!=='string'||typeof m.company?.name!=='string')throw new Error('Invalid manifest');
      count++;companies.push({externalId:m.company.externalId,name:m.company.name});
    } catch {damaged++;}
  }
  return {count,damaged,companies};
}
function readHistory(state) {
  try {const value=JSON.parse(fs.readFileSync(path.join(state,'history.json'),'utf8'));return Array.isArray(value)?value.slice(-50):[];}
  catch {return [];}
}
function saveHistory(state,entry) {
  const history=[...readHistory(state),entry].slice(-50);
  fs.mkdirSync(state,{recursive:true});
  const file=path.join(state,'history.json');
  fs.writeFileSync(file+'.tmp',JSON.stringify(history),{mode:0o600});fs.renameSync(file+'.tmp',file);
  return history;
}
module.exports={validateSelection,pendingSummary,readHistory,saveHistory};
