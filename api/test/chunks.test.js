const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../src/ingestChunks');
const api = require('../src/ingestChunks');
const db = require('../src/db');
after(() => db.close());
test('manifest validates totals and bounds before allocating staging', () => {
  const input = { batchId: 'batch', capturedAt: new Date().toISOString(), fullSnapshot: true,
    company: { externalId: 'guid', name: 'Example' }, chunkCount: 2, ledgerCount: 1, voucherCount: 1 };
  assert.equal(validateManifest(input).chunkCount, 2);
  assert.throws(() => validateManifest({ ...input, chunkCount: 10001 }));
  assert.throws(() => validateManifest({ ...input, voucherCount: -1 }));
  assert.throws(() => validateManifest({ ...input, company: { name: 'No GUID' } }));
});
test('staged snapshot exceeds both legacy request limits without one large payload', {
  skip:process.env.DB_NAME!=='enterprise_dashboard_test'
}, async () => {
  await db.migrate();
  const manifest={batchId:'large-staged',capturedAt:'2026-09-09T00:00:00Z',fullSnapshot:true,
    company:{externalId:'large-company',name:'Large Company'},chunkCount:51,ledgerCount:0,voucherCount:50100};
  await api.begin(manifest);
  let bytes=0;
  for(let index=0;index<51;index++) {
    const payload={batchId:manifest.batchId,index,ledgers:[],vouchers:Array.from({length:index===50 ? 100 : 1000},()=>({
      date:'2026-09-01',type:'Sales',amount:'123.45',narration:'x'.repeat(400)
    }))};
    bytes+=Buffer.byteLength(JSON.stringify(payload));
    await api.chunk(payload);
  }
  assert.ok(bytes>20*1024*1024);
  const result=await api.complete({batchId:manifest.batchId});
  assert.equal(result.voucherCount,50100);
  assert.equal((await db.query('SELECT count(*) FROM "Vouchers"')).rows[0].count,'50100');
  await db.query('TRUNCATE tally_uploads, tally_ingestions, "Vouchers", "Projects", "Ledgers", "Companies", "SyncLog" RESTART IDENTITY CASCADE');
});
test('staging protects live data, retries are immutable, complete is atomic and repeatable', {
  skip:process.env.DB_NAME!=='enterprise_dashboard_test'
}, async () => {
  await db.migrate();
  const manifest={batchId:'staged-1',capturedAt:'2026-09-09T00:00:00Z',fullSnapshot:true,
    company:{externalId:'staged-company',name:'Staged Company'},chunkCount:2,ledgerCount:1,voucherCount:1};
  const ledgers={batchId:manifest.batchId,index:0,ledgers:[{name:'Cash',group:'Cash',balance:'12000.00'}],vouchers:[]};
  const vouchers={batchId:manifest.batchId,index:1,ledgers:[],vouchers:[{date:'2026-09-01',type:'Sales',amount:'5000.00'}]};
  await api.begin(manifest); await api.chunk(ledgers);
  assert.equal((await api.chunk(ledgers)).duplicate,true);
  await assert.rejects(()=>api.chunk({...ledgers,ledgers:[{...ledgers.ledgers[0],balance:'1.00'}]}),/conflict/);
  await assert.rejects(()=>api.complete({batchId:manifest.batchId}),/incomplete/);
  assert.equal((await db.query('SELECT count(*) FROM "Companies"')).rows[0].count,'0');
  await api.chunk(vouchers);
  const result=await api.complete({batchId:manifest.batchId});
  assert.equal(result.ledgerCount,1); assert.equal(result.voucherCount,1);
  assert.equal((await api.complete({batchId:manifest.batchId})).duplicate,true);
  assert.equal((await api.begin(manifest)).completed,true);
  const bad={...manifest,batchId:'bad-count',capturedAt:'2026-09-10T00:00:00Z',voucherCount:2};
  await api.begin(bad); await api.chunk({...ledgers,batchId:bad.batchId}); await api.chunk({...vouchers,batchId:bad.batchId});
  await assert.rejects(()=>api.complete({batchId:bad.batchId}),/counts/);
  assert.equal((await db.query('SELECT "Amount" FROM "Vouchers"')).rows[0].Amount,'5000.00');
  const duplicates={...bad,batchId:'duplicate-ledgers',ledgerCount:2,voucherCount:0};
  await api.begin(duplicates);
  await api.chunk({...ledgers,batchId:duplicates.batchId});
  await api.chunk({...ledgers,batchId:duplicates.batchId,index:1});
  await assert.rejects(()=>api.complete({batchId:duplicates.batchId}),/Duplicate ledger/);
  assert.equal((await db.query('SELECT count(*) FROM tally_ingestions')).rows[0].count,'1');
  await db.query('TRUNCATE tally_uploads, tally_ingestions, "Vouchers", "Projects", "Ledgers", "Companies", "SyncLog" RESTART IDENTITY CASCADE');
});
