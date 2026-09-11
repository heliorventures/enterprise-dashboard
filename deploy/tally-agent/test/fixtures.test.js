const {test}=require('node:test');
const assert=require('node:assert/strict');
const {xml}=require('../fixture-runner');
const {parseXml,ledger,voucher}=require('../tally');
const versions=[require('../fixtures/version-1.json'),require('../fixtures/version-2.json')];
test('both sample versions traverse the same XML mapping with stable company identity',()=>{
  assert.equal(versions[0].company.externalId,versions[1].company.externalId);
  for(const [index,fixture] of versions.entries()) {
    const companies=[],ledgers=[],vouchers=[];
    parseXml('COMPANY',row=>companies.push(row)).write(xml(fixture,'COMPANY')).close();
    parseXml('LEDGER',row=>ledgers.push(ledger(row))).write(xml(fixture,'LEDGER')).close();
    parseXml('VOUCHER',row=>vouchers.push(voucher(row))).write(xml(fixture,'VOUCHER')).close();
    assert.equal(companies[0].GUID,fixture.company.externalId);
    assert.equal(ledgers.length,5);assert.equal(vouchers.length,index+2);
    assert.equal(ledgers.find(row=>row.name==='Test Sales').balance,index===0?'100000.00':'150000.00');
    assert.equal(vouchers[1].number,'TEST-P001');
    assert.equal(vouchers[1].amount,index===0?'30000.00':'45000.00');
  }
});
