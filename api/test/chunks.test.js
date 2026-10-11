const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../src/ingestChunks');
const api = require('../src/ingestChunks');
const db = require('../src/db');
const { createHash } = require('node:crypto');
after(() => db.close());
test('manifest validates totals and bounds before allocating staging', () => {
  const input = { batchId: 'batch', capturedAt: new Date().toISOString(), fullSnapshot: true,
    company: { externalId: 'guid', name: 'Example' }, chunkCount: 2, ledgerCount: 1, voucherCount: 1 };
  assert.equal(validateManifest(input).chunkCount, 2);
  assert.throws(() => validateManifest({ ...input, chunkCount: 10001 }));
  assert.throws(() => validateManifest({ ...input, voucherCount: -1 }));
  assert.throws(() => validateManifest({ ...input, company: { name: 'No GUID' } }));
});
test('completed chunk receipts validate normalized content and reject missing evidence', async (t) => {
  const manifest = validateManifest({ batchId: 'receipt', capturedAt: '2026-09-09T00:00:00Z', fullSnapshot: true,
    company: { externalId: 'receipt-company', name: 'Receipt Company' }, chunkCount: 1, ledgerCount: 1, voucherCount: 0 });
  const input = { batchId: manifest.batchId, index: 0,
    ledgers: [{ name: 'Cash', group: 'Cash', balance: '12.00' }], vouchers: [] };
  const checksum = createHash('sha256').update(JSON.stringify({
    ledgers: [{ name: 'Cash', group: 'Cash', balance: '12.00', sourceKey: 'ledger:cash' }], vouchers: [],
  })).digest('hex');
  const upload = { batch_id: manifest.batchId, manifest, bytes: 0,
    result: { ok: true, batchId: manifest.batchId, chunkChecksums: [checksum] } };
  t.mock.method(db, 'transaction', async work => work({ query: async sql => {
    if (sql.includes('FROM tally_uploads')) return { rows: [upload] };
    if (sql.includes('FROM tally_upload_chunks')) return { rows: [] };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    throw new Error(`Unexpected receipt query: ${sql}`);
  } }));
  assert.equal((await api.chunk(input)).completed, true);
  assert.equal((await api.chunk({ ...input, ledgers: [{ balance: '12.00', group: 'Cash', name: ' Cash ' }] })).completed, true);
  await assert.rejects(() => api.chunk({ ...input, ledgers: [{ ...input.ledgers[0], balance: '13.00' }] }), { status: 409 });
  await assert.rejects(() => api.chunk({ ...input, index: 1 }), { status: 400 });
  await assert.rejects(() => api.chunk({ ...input, ledgers: undefined }), { status: 400 });
  await assert.rejects(() => api.chunk({ ...input, ledgers: [{ ...input.ledgers[0], balance: 'invalid' }] }), { status: 400 });
  const replay = await api.complete({ batchId: manifest.batchId });
  assert.equal(replay.duplicate, true);
  assert.equal(Object.hasOwn(replay, 'chunkChecksums'), false);
  delete upload.result.chunkChecksums;
  await assert.rejects(() => api.chunk(input), { status: 409 });
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
  assert.equal((await api.chunk(ledgers)).completed,true);
  assert.equal((await api.chunk(vouchers)).completed,true);
  await assert.rejects(()=>api.chunk({...ledgers,ledgers:[{...ledgers.ledgers[0],balance:'1.00'}]}),{status:409});
  await assert.rejects(()=>api.chunk({...ledgers,index:2}),{status:400});
  assert.equal((await db.query('SELECT count(*) FROM tally_upload_chunks WHERE batch_id=$1',[manifest.batchId])).rows[0].count,'0');
  const receipt=(await db.query('SELECT result FROM tally_uploads WHERE batch_id=$1',[manifest.batchId])).rows[0].result;
  assert.equal(receipt.chunkChecksums.length,2);
  assert.equal(Object.hasOwn(await api.complete({batchId:manifest.batchId}),'chunkChecksums'),false);
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
