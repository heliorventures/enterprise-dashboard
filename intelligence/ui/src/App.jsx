import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, inr, statusTone } from './api';

function Chip({ value }) {
  return <span className={`chip ${statusTone(value)}`}>{String(value || '—').replaceAll('_', ' ')}</span>;
}

function useLoad(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    setLoading(true);
    loader()
      .then((value) => on && setData(value))
      .catch((err) => on && setError(err.message))
      .finally(() => on && setLoading(false));
    return () => { on = false; };
  }, deps);
  return { data, error, loading, setData };
}

function PageHeader({ eyebrow, title, description, children }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="description">{description}</p>}
      </div>
      {children ? <div className="controls">{children}</div> : null}
    </header>
  );
}

function Kpi({ label, value, hint, tone }) {
  return (
    <div className="kpi" data-tone={tone || undefined}>
      <article>
        <p>{label}</p>
        <strong className="num">{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </article>
    </div>
  );
}

function Shell({ user, onLogout, children }) {
  const links = [
    ['/imports', 'Imports'],
    ['/results', 'Import results'],
    ['/outstanding', 'Outstanding'],
    ['/ageing', 'Ageing'],
    ['/reconciliation', 'Reconciliation'],
    ['/exceptions', 'Exceptions'],
    ['/work-queue', 'Work queue'],
    ['/quality', 'Data quality'],
    ['/reports', 'Reports'],
    ['/admin', 'Administration'],
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/brand-mark.svg" width="40" height="40" alt="" />
          <div><strong>Excel import</strong><span>One company per file</span></div>
        </div>
        <nav aria-label="Main navigation">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/imports'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>{label}</NavLink>
          ))}
          <button type="button" className="nav-link sign-out" onClick={onLogout}>Sign out</button>
        </nav>
        <div className="sidebar-foot">
          <p className="signed-in">Signed in as {user.username}</p>
          <p>Does not change the multi-company Tally dashboard.</p>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  return (
    <section className="login-screen">
      <form className="login-card" onSubmit={async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try { onLogin(await api.login(username, password)); } catch (err) { setError(err.message); setSubmitting(false); }
      }}>
        <div className="brand">
          <img src="/brand-mark.svg" width="40" height="40" alt="" />
          <div><strong>Excel import</strong><span>Helior workspace</span></div>
        </div>
        <header>
          <p className="eyebrow">Secure access</p>
          <h1>Sign in</h1>
          <p>Upload one company’s operational Excel. The existing Tally dashboard stays as it is.</p>
        </header>
        {error && <p className="banner" role="alert">{error}</p>}
        <label className="field"><span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button className="btn primary" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        <p className="hint">Sessions last 12 hours. Use the Angular dashboard for multi-company books.</p>
      </form>
    </section>
  );
}

function Dashboard() {
  const [companyId, setCompanyId] = useState('');
  const companies = useLoad(() => api.companies());
  const { data, error, loading } = useLoad(() => api.summary(companyId), [companyId]);
  const cards = data?.cards || {};
  return (
    <section className="page">
      <PageHeader eyebrow={companyId ? 'Selected company' : 'Imported files'} title="Import results" description="Results from Excel files you uploaded. This is not the multi-company Tally overview.">
        <label className="field"><span>Company</span>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">All companies</option>
            {(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </PageHeader>
      {error && <p className="banner" role="alert">{error}</p>}
      {loading && <p className="empty" role="status">Loading import results…</p>}
      {data && (
        <>
          <p className="scope-line"><span>Excel import vs Tally ledgers for the company on each file</span><span>{cards.records} accounts</span></p>
          <section className="kpi-grid" aria-label="Financial indicators">
            <Kpi label="Total outstanding" value={inr(cards.totalOutstanding)} hint="Pending debit less pending credit" />
            <Kpi label="Total paid" value={inr(cards.totalPaid)} />
            <Kpi label="Financial gap" value={inr(cards.totalFinancialGap)} hint="Absolute source vs Tally difference" tone={cards.totalFinancialGap ? 'negative' : 'positive'} />
            <Kpi label="Critical exceptions" value={cards.criticalExceptions} tone={cards.criticalExceptions ? 'negative' : undefined} />
            <Kpi label="Matched" value={cards.matched} tone="positive" />
            <Kpi label="Unmatched" value={cards.unmatched} />
            <Kpi label="Open exceptions" value={cards.openExceptions} />
            <Kpi label="Accounts" value={cards.records} />
          </section>
          <div className="chart-grid">
            <div className="panel">
              <header><h2>Ageing</h2></header>
              <div className="bars">
                {(data.ageing || []).map((row) => (
                  <div className="bar" key={row.bucket}>
                    <span>{row.label}</span>
                    <i style={{ width: `${Math.min(100, Math.abs(row.pct || 8))}%` }} />
                    <strong className="num">{inr(row.net)}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <header><h2>Outstanding by company</h2></header>
              <div className="desktop-table">
                <table>
                  <thead><tr><th>Company</th><th className="numeric">Outstanding</th><th className="numeric">Gap</th></tr></thead>
                  <tbody>
                    {(data.byCompany || []).map((row) => (
                      <tr key={row.id}><td>{row.name}</td><td className="numeric">{inr(row.outstanding)}</td><td className="numeric">{inr(row.gap)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="panel">
            <header><h2>Top outstanding accounts</h2></header>
            <div className="desktop-table">
              <table>
                <thead><tr><th>Account</th><th>Company</th><th className="numeric">Pending Dr</th><th className="numeric">Pending Cr</th><th className="numeric">Tally</th><th>Status</th></tr></thead>
                <tbody>
                  {(data.topAccounts || []).map((row) => (
                    <tr key={row.id}>
                      <td><NavLink to={`/accounts/${row.id}`}>{row.account_name}</NavLink></td>
                      <td>{row.company_name}</td>
                      <td className="numeric">{inr(row.pending_bill_debit)}</td>
                      <td className="numeric">{inr(row.pending_bill_credit)}</td>
                      <td className="numeric">{inr(row.tally_amount)}</td>
                      <td><Chip value={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Imports() {
  const { data, error } = useLoad(() => api.imports());
  return (
    <section className="page">
      <PageHeader eyebrow="Excel" title="Imports" description="Each file belongs to one company. The existing dashboard and Tally books are not changed.">
        <NavLink className="btn primary" to="/imports/new">New import</NavLink>
      </PageHeader>
      {error && <p className="banner" role="alert">{error}</p>}
      <div className="panel">
        <div className="desktop-table">
        <table>
          <thead><tr><th>File</th><th>Company</th><th>Source</th><th>Rows</th><th>Valid</th><th>Errors</th><th>Status</th><th>Uploaded</th></tr></thead>
          <tbody>
            {(data || []).map((row) => (
              <tr key={row.id}>
                <td><NavLink to={`/imports/${row.id}`}>{row.file_name}</NavLink></td>
                <td>{row.company_name || row.detected_company}</td>
                <td>{row.source_name}</td>
                <td>{row.detail_rows ?? row.total_rows}</td>
                <td>{row.successful_rows}</td>
                <td>{row.failed_rows}</td>
                <td><Chip value={row.status} /></td>
                <td>{row.uploaded_at ? new Date(row.uploaded_at).toLocaleString() : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

function Wizard() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [companyId, setCompanyId] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [validation, setValidation] = useState(null);
  const [processed, setProcessed] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const companies = useLoad(() => api.companies());
  const sources = useLoad(() => api.sources());
  const fields = useLoad(() => api.fields());
  const analysis = result?.analysis || preview;
  const steps = ['Company', 'Source', 'Upload', 'Analysis', 'Preview', 'Mapping', 'Validation', 'Process', 'Reconcile', 'Results'];
  async function upload() {
    if (!companyId) {
      setError('Select the company this Excel file belongs to. Upload does not auto-detect or switch companies.');
      return;
    }
    if (!file) {
      setError('Choose an Excel file.');
      return;
    }
    setBusy('Analyzing workbook…'); setError('');
    try {
      const data = await api.upload(file, companyId);
      setResult(data);
      setPreview(data.analysis);
      setStep(4);
      if (data.companyMismatch) {
        setError(`File banner company "${data.analysis?.company?.company || 'unknown'}" does not match selected company "${data.selectedCompany?.name}". The file is still assigned to the company you selected.`);
      }
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function runValidate() {
    setBusy('Validating…');
    try {
      const mappings = (analysis.columns || []).map((col) => ({ sourceHeader: col.canonical, targetField: col.target || null }));
      await api.mapping(result.file.id, mappings);
      setValidation(await api.validate(result.file.id));
      setStep(7);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  async function runProcess() {
    setBusy('Processing and reconciling against Tally…');
    try { setProcessed(await api.process(result.file.id)); setStep(10); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  }
  return (
    <section className="page">
      <PageHeader eyebrow="Excel" title="Import wizard" description="Select one company, then upload that company’s Excel file. Tally books are read-only." />
      <div className="steps">{steps.map((label, i) => <span key={label} className={step === i + 1 ? 'on' : ''}>{i + 1}. {label}</span>)}</div>
      {error && <p className="banner" role="alert">{error}</p>}
      {busy && <p className="banner info" role="status">{busy}</p>}
      {step <= 3 && (
        <div className="panel">
          <header><h2>Upload</h2></header>
          <div className="section-copy">
            <div className="controls">
              <label className="field"><span>Company (required)</span>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                  <option value="">Select company</option>
                  {(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Source system</span>
                <select defaultValue="">{(sources.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </label>
            </div>
          </div>
          <div className="drop" style={{ margin: '0 24px 16px' }}>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <p className="muted">One company per file. Category and total rows are not imported as transactions.</p>
          </div>
          <div className="section-copy">
            <button className="btn primary" disabled={!file || !companyId || !!busy} onClick={upload}>Analyze file</button>
            {result?.duplicate && <p className="muted">This file appears to have already been imported on {new Date(result.duplicate.uploaded_at).toLocaleString()}.</p>}
          </div>
        </div>
      )}
      {analysis && step >= 4 && step < 8 && (
        <div className="panel">
          <p><strong>{analysis.title}</strong></p>
          <p>Selected company: {result?.selectedCompany?.name || companies.data?.find((c) => c.id === companyId)?.name}</p>
          <p>File banner: {analysis.company?.company || '—'} · {analysis.period?.from} → {analysis.period?.to}</p>
          <p className="muted">{analysis.counts?.dataRows} detail · {analysis.counts?.groupRows} group · {analysis.counts?.totalRows} total</p>
          {step === 5 && (
            <table>
              <thead><tr><th>Account</th><th>Path</th><th>Type</th></tr></thead>
              <tbody>
                {(analysis.preview || []).slice(0, 50).map((row) => (
                  <tr key={row.sourceRowNumber}><td>{row.raw.Particulars}</td><td>{(row.categoryPath || []).join(' / ')}</td><td>{row.rowType}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {step === 6 && (
            <table>
              <thead><tr><th>Source column</th><th>Target field</th><th>Status</th></tr></thead>
              <tbody>
                {(analysis.columns || []).map((col) => (
                  <tr key={col.index}>
                    <td>{col.canonical}</td>
                    <td>
                      <select defaultValue={col.target || ''} onChange={(e) => { col.target = e.target.value || null; }}>
                        <option value="">Unmapped — keep in staging</option>
                        {(fields.data || []).map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                      </select>
                    </td>
                    <td>{col.unmapped && !col.target ? 'Review' : 'Mapped'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {validation && step === 7 && (
            <p>Valid {validation.valid} · Warnings {validation.warnings} · Errors {validation.errors}</p>
          )}
          <div className="section-copy row">
            {step === 4 && <button className="btn primary" onClick={() => setStep(5)}>Preview rows</button>}
            {step === 5 && <button className="btn primary" onClick={() => setStep(6)}>Column mapping</button>}
            {step === 6 && <button className="btn primary" onClick={runValidate}>Validate</button>}
            {step === 7 && <button className="btn primary" onClick={runProcess}>Process & reconcile</button>}
          </div>
        </div>
      )}
      {processed && step === 10 && (
        <div className="panel">
          <header><h2>Results</h2></header>
          <p className="section-copy">Batch {processed.batch?.status} · {processed.batch?.source_total_status}</p>
          <div className="desktop-table">
          <table>
            <thead><tr><th>Reconciliation</th><th>Count</th><th className="numeric">Difference</th></tr></thead>
            <tbody>
              {(processed.reconciliation || []).map((row) => (
                <tr key={row.status}><td><Chip value={row.status} /></td><td>{row.count}</td><td className="numeric">{inr(row.difference)}</td></tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="section-copy"><button className="btn primary" onClick={() => nav(`/imports/${processed.file.id}`)}>Open import</button></div>
        </div>
      )}
    </section>
  );
}

function ImportDetail() {
  const { id } = useParams();
  const { data, error } = useLoad(() => api.importFile(id), [id]);
  const errors = useLoad(() => api.errors(id), [id]);
  return (
    <section className="page">
      <PageHeader eyebrow={data?.companyName} title={data?.file?.fileName || 'Import'} description={data?.file?.detectedTitle} />
      {error && <p className="banner" role="alert">{error}</p>}
      {data?.batch && (
        <section className="kpi-grid">
          {[['Detail rows', data.batch.detail_rows], ['Successful', data.batch.successful_rows], ['Warnings', data.batch.warning_rows], ['Errors', data.batch.failed_rows]].map(([l, v]) => (
            <Kpi key={l} label={l} value={v} />
          ))}
        </section>
      )}
      <div className="panel">
        <header><h2>Source total check</h2></header>
        <p className="section-copy"><Chip value={data?.batch?.source_total_status} /> Source Dr {inr(data?.batch?.source_total_debit)} vs calculated {inr(data?.batch?.calculated_total_debit)}</p>
      </div>
      <div className="panel">
        <header><h2>Row issues</h2></header>
        <div className="desktop-table">
        <table>
          <thead><tr><th>Row</th><th>Status</th><th>Errors</th></tr></thead>
          <tbody>
            {(errors.data || []).map((row) => (
              <tr key={row.source_row_number}><td>{row.source_row_number}</td><td>{row.validation_status}</td><td>{JSON.stringify(row.errors)}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

function Outstanding() {
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api.outstanding({ q, pageSize: 100 }), [q]);
  return (
    <section className="page">
      <PageHeader eyebrow="Imported Excel" title="Outstanding" description="Net pending debit and credit from uploaded files, scoped to the company on each import.">
        <label className="field"><span>Search</span>
          <input placeholder="Account, PAN, GST" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </PageHeader>
      {error && <p className="banner" role="alert">{error}</p>}
      <div className="panel">
        <div className="desktop-table">
        <table>
          <thead><tr><th>Account</th><th>Company</th><th>Bill</th><th>Paid</th><th>Pending Dr</th><th>Pending Cr</th><th>Last payment</th><th>Status</th></tr></thead>
          <tbody>
            {(data?.items || []).map((row) => (
              <tr key={row.id}>
                <td><NavLink to={`/accounts/${row.account_id}`}>{row.account_name}</NavLink></td>
                <td>{row.company_name}</td>
                <td>{inr(row.bill_amount)}</td>
                <td>{inr(row.paid_amount)}</td>
                <td>{inr(row.pending_bill_debit)}</td>
                <td>{inr(row.pending_bill_credit)}</td>
                <td>{row.last_payment_date || '—'}</td>
                <td><Chip value={row.recon_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

function Ageing() {
  const { data } = useLoad(() => api.ageing());
  return (
    <section className="page">
      <PageHeader eyebrow="Imported Excel" title="Ageing analysis" description="Buckets are taken from the report header, including the source dates." />
      <div className="panel">
        <div className="desktop-table">
        <table>
          <thead><tr><th>Ageing</th><th>From</th><th>To</th><th>Debit</th><th>Credit</th><th>Net</th><th>%</th></tr></thead>
          <tbody>
            {(data?.buckets || []).map((row) => (
              <tr key={row.ageing_bucket}><td>{row.bucket_label}</td><td>{row.bucket_from}</td><td>{row.bucket_to}</td><td className="numeric">{inr(row.debit)}</td><td className="numeric">{inr(row.credit)}</td><td className="numeric">{inr(row.net)}</td><td>{row.pct}%</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

function Reconciliation() {
  const { data } = useLoad(() => api.recon());
  return (
    <section className="page">
      <PageHeader eyebrow="Read-only Tally" title="Reconciliation" description="Each file is matched only to that company’s existing Tally ledgers. Tally is never written." />
      <div className="panel">
        <div className="desktop-table">
        <table>
          <thead><tr><th>Account</th><th>Source</th><th>Tally</th><th>Difference</th><th>Method</th><th>Status</th></tr></thead>
          <tbody>
            {(data || []).slice(0, 200).map((row) => (
              <tr key={row.id}>
                <td>{row.account_name || row.tally_ledger_name}</td>
                <td>{inr(row.source_amount)}</td>
                <td>{inr(row.tally_amount)}</td>
                <td>{inr(row.difference)}</td>
                <td>{row.match_method || '—'}</td>
                <td><Chip value={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

function Exceptions({ queue }) {
  const { data, setData } = useLoad(() => api.exceptions({ status: queue ? 'OPEN' : '' }));
  async function act(id, status) {
    const updated = await api.updateException(id, { status, comment: status });
    setData((rows) => rows.map((row) => (row.id === id ? { ...row, ...updated } : row)));
  }
  return (
    <section className="page">
      <PageHeader eyebrow="Actions" title={queue ? 'Work queue' : 'Exceptions'} description="Mismatches, missing Tally records and data-quality issues." />
      <div className="panel">
        <div className="desktop-table">
        <table>
          <thead><tr><th>Issue</th><th>Account</th><th>Severity</th><th>Status</th><th>Owner</th><th></th></tr></thead>
          <tbody>
            {(data || []).map((row) => (
              <tr key={row.id}>
                <td>{row.title}</td>
                <td>{row.account_name}</td>
                <td><Chip value={row.severity} /></td>
                <td><Chip value={row.status} /></td>
                <td>{row.owner || 'Unassigned'}</td>
                <td className="row">
                  <button className="btn ghost" onClick={() => act(row.id, 'RESOLVED')}>Resolve</button>
                  <button className="btn ghost" onClick={() => act(row.id, 'REJECTED')}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

function Account() {
  const { id } = useParams();
  const { data, error } = useLoad(() => api.account(id), [id]);
  const a = data?.account;
  const o = data?.outstanding?.[0];
  return (
    <section className="page">
      <PageHeader eyebrow={a?.company_name} title={a?.account_name || 'Account'} description={(a?.category_path || []).join(' / ')} />
      {error && <p className="banner" role="alert">{error}</p>}
      {a && (
        <>
          <section className="kpi-grid">
            <Kpi label="GST" value={a.gst_number || '—'} />
            <Kpi label="PAN" value={a.pan_number || '—'} />
            <Kpi label="MSME" value={a.msme_number || '—'} />
            <Kpi label="Credit days" value={a.credit_days ?? '—'} />
          </section>
          {o && (
            <div className="panel">
              <header><h2>Financial summary</h2></header>
              <p className="section-copy">Bill {inr(o.bill_amount)} · Paid {inr(o.paid_amount)} · Pending Dr {inr(o.pending_bill_debit)} · Pending Cr {inr(o.pending_bill_credit)}</p>
              <p className="section-copy">Last payment {inr(o.last_payment_amount)} on {o.last_payment_date || '—'} · Requisition {inr(o.last_payment_requisition_amount)}</p>
              <p className="section-copy">Tally {inr(o.tally_amount)} · Source {inr(o.source_amount)} · Difference {inr(o.difference)} · <Chip value={o.status} /></p>
            </div>
          )}
          <div className="panel">
            <header><h2>Ageing</h2></header>
            <div className="desktop-table">
            <table>
              <thead><tr><th>Bucket</th><th className="numeric">Debit</th><th className="numeric">Credit</th></tr></thead>
              <tbody>{(data.ageing || []).map((row) => <tr key={row.id}><td>{row.bucket_label}</td><td className="numeric">{inr(row.debit_amount)}</td><td className="numeric">{inr(row.credit_amount)}</td></tr>)}</tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Quality() {
  const { data } = useLoad(() => api.quality());
  return (
    <section className="page">
      <PageHeader eyebrow="Quality" title="Data quality" description="Missing identifiers, total mismatches and unmapped source fields." />
      {data && (
        <section className="kpi-grid">
          {[['Accounts', data.accounts], ['Missing GST', data.missing_gst], ['Missing PAN', data.missing_pan], ['Missing MSME', data.missing_msme], ['Missing payment date', data.missing_payment_date]].map(([l, v]) => (
            <Kpi key={l} label={l} value={v} />
          ))}
        </section>
      )}
    </section>
  );
}

function Reports() {
  return (
    <section className="page">
      <PageHeader eyebrow="Exports" title="Reports" description="CSV extracts for outstanding, gaps and exceptions." />
      <div className="panel">
        <div className="section-copy row">
          <a className="btn primary" href="/api/reports/outstanding.csv">Outstanding CSV</a>
          <a className="btn ghost" href="/api/reports/reconciliation.csv">Reconciliation CSV</a>
          <a className="btn ghost" href="/api/reports/exceptions.csv">Exception CSV</a>
          <a className="btn ghost" href="/api/reports/quality.csv">Data quality CSV</a>
        </div>
      </div>
    </section>
  );
}

function Admin() {
  const audit = useLoad(() => api.audit());
  const companies = useLoad(() => api.companies());
  return (
    <section className="page">
      <PageHeader eyebrow="Console" title="Administration" description="Companies, source systems, mapping catalog and audit trail." />
      <div className="panel">
        <header><h2>Companies</h2></header>
        <div className="desktop-table">
        <table>
          <thead><tr><th>Name</th><th>Tally id</th></tr></thead>
          <tbody>{(companies.data || []).map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.tally_company_id || '—'}</td></tr>)}</tbody>
        </table>
        </div>
      </div>
      <div className="panel">
        <header><h2>Audit</h2></header>
        <div className="desktop-table">
        <table>
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th></tr></thead>
          <tbody>{(audit.data || []).map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString()}</td><td>{row.username}</td><td>{row.action}</td><td>{row.entity}</td></tr>)}</tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api.session().then((d) => setUser(d.user)).catch(() => setUser(null)).finally(() => setReady(true));
  }, []);
  if (!ready) return <div className="boot" role="status">Loading Excel import…</div>;
  if (!user) return <Login onLogin={(d) => setUser(d.user)} />;
  return (
    <Shell user={user} onLogout={async () => { await api.logout(); setUser(null); }}>
      <Routes>
        <Route path="/" element={<Navigate to="/imports" replace />} />
        <Route path="/results" element={<Dashboard />} />
        <Route path="/imports" element={<Imports />} />
        <Route path="/imports/new" element={<Wizard />} />
        <Route path="/imports/:id" element={<ImportDetail />} />
        <Route path="/outstanding" element={<Outstanding />} />
        <Route path="/ageing" element={<Ageing />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
        <Route path="/exceptions" element={<Exceptions />} />
        <Route path="/work-queue" element={<Exceptions queue />} />
        <Route path="/quality" element={<Quality />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/accounts/:id" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
