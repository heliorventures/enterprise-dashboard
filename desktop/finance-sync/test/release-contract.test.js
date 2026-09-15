const {test}=require('node:test');
const assert=require('node:assert/strict');
const {REQUIRED_SCENARIOS,validateE2EReport}=require('../scripts/release-contract');
const complete=()=>({passed:true,scenarios:REQUIRED_SCENARIOS.map(name=>({name,status:'passed'}))});
test('release gate requires every named scenario, not only a passing prefix',()=>{
  assert.ok(REQUIRED_SCENARIOS.length>=19);
  const report=complete();assert.equal(validateE2EReport(report),REQUIRED_SCENARIOS.length);
  for(let length=0;length<REQUIRED_SCENARIOS.length;length++)assert.throws(()=>validateE2EReport({...report,scenarios:report.scenarios.slice(0,length)}),/scenario/i);
});
test('release gate rejects failed, duplicated, unknown and missing scenario evidence',()=>{
  const failed=complete();failed.scenarios[0].status='failed';assert.throws(()=>validateE2EReport(failed));
  const duplicate=complete();duplicate.scenarios[1]={...duplicate.scenarios[0]};assert.throws(()=>validateE2EReport(duplicate));
  const unknown=complete();unknown.scenarios[0].name='unapproved substitute';assert.throws(()=>validateE2EReport(unknown));
  assert.throws(()=>validateE2EReport({passed:true}));assert.throws(()=>validateE2EReport({...complete(),passed:false}));
});
