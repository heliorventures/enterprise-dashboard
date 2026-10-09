(async () => {
  const login = await fetch('http://localhost:3010/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  });
  const cookie = (login.headers.getSetCookie?.() || [login.headers.get('set-cookie')])
    .filter(Boolean)
    .map((s) => String(s).split(';')[0])
    .join('; ');
  const id = process.argv[2];
  console.time('process');
  const proc = await fetch('http://localhost:3010/api/imports/' + id + '/reprocess', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  console.timeEnd('process');
  const processed = await proc.json();
  console.log('status', proc.status);
  if (processed.error) console.log(processed);
  else {
    console.log({
      batch: processed.batch?.status,
      detail: processed.batch?.detail_rows,
      ok: processed.batch?.successful_rows,
      fail: processed.batch?.failed_rows,
      warn: processed.batch?.warning_rows,
      total: processed.batch?.source_total_status,
      debit: processed.batch?.source_total_debit,
      calc: processed.batch?.calculated_total_debit,
      recon: processed.reconciliation,
    });
    const dash = await fetch('http://localhost:3010/api/dashboard/summary', { headers: { Cookie: cookie } });
    console.log('dashboard', (await dash.json()).cards);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
