const {test}=require('node:test');
const assert=require('node:assert/strict');
const source=require('../source-export');
function parse(content,step=100000) {
  const rows=[],xml=source.parser('GROUP',row=>rows.push(row));
  const input='<?xml version="1.0"?><ENVELOPE><BODY><DATA><COLLECTION>'+content+'</COLLECTION></DATA></BODY></ENVELOPE>';
  for(let i=0;i<input.length;i+=step)xml.write(input.slice(i,i+step));
  xml.close();return {rows,diagnostics:xml.diagnostics()};
}
test('Tally decimal/hex references and literal 4/5 controls survive all stream splits and JSON serialization',()=>{
  const record='<GROUP NAME="\u0005name&#4;"><ADDLALLOCTYPE>&#4; Not Applicable</ADDLALLOCTYPE><CLASSNAME>\u0005class\u0005</CLASSNAME><HEX>&#x04;&#x5;&#0004;</HEX><RAW>\u0004</RAW></GROUP>';
  for(const step of [1,2,3,7,100000]) {
    const {rows,diagnostics}=parse(record,step);
    const row=JSON.parse(JSON.stringify(rows[0]));
    assert.equal(row.attributes.NAME,'\u0005name\u0004');
    assert.equal(source.field(row,'ADDLALLOCTYPE'),'\u0004 Not Applicable');
    assert.equal(source.field(row,'CLASSNAME'),'\u0005class\u0005');
    assert.equal(source.field(row,'HEX'),'\u0004\u0005\u0004');
    assert.equal(source.field(row,'RAW'),'\u0004');
    assert.ok(diagnostics.tallyControlCharacters.reference4>0);
    assert.ok(diagnostics.tallyControlCharacters.literal5>0);
  }
});
test('compatibility does not reinterpret escaped text or CDATA references, or normalize XML 1.0 Unicode text',()=>{
  const {rows}=parse('<GROUP><ESCAPED>&amp;#4;</ESCAPED><CDATA><![CDATA[&#4;\u0005]]></CDATA><TEXT>\u0085\u2028 original </TEXT></GROUP>',1);
  assert.equal(source.field(rows[0],'ESCAPED'),'&#4;');
  assert.equal(source.field(rows[0],'CDATA'),'&#4;\u0005');
  assert.equal(source.field(rows[0],'TEXT'),'\u0085\u2028 original ');
});
test('structural XML errors, NUL, unknown controls, entities and DTDs remain errors',()=>{
  for(const record of ['<GROUP><X>&#0;</X></GROUP>','<GROUP><X>\u0000</X></GROUP>',
    '<GROUP><X>\u0006</X></GROUP>','<GROUP><X>&#6;</X></GROUP>',
    '<GROUP><X>&unknown;</X></GROUP>','<GROUP><X></GROUP>',
    '<GROUP\u0005/>','<GROUP bad\u0005name="x"/>'])assert.throws(()=>parse(record));
  const xml=source.parser('GROUP',()=>{});
  assert.throws(()=>xml.write('<!DOCTYPE ENVELOPE><ENVELOPE/>'),/DTD/);
});
