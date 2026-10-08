async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(data?.error || 'Request failed');
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  session: () => request('/api/auth/session'),
  login: (username, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: '{}' }),
  companies: () => request('/api/companies'),
  sources: () => request('/api/sources'),
  fields: () => request('/api/fields'),
  summary: (companyId) => request('/api/dashboard/summary' + (companyId ? `?companyId=${companyId}` : '')),
  outstanding: (params) => request('/api/outstanding?' + new URLSearchParams(params)),
  ageing: (companyId) => request('/api/ageing' + (companyId ? `?companyId=${companyId}` : '')),
  recon: (params) => request('/api/reconciliation?' + new URLSearchParams(params || {})),
  quality: (companyId) => request('/api/quality' + (companyId ? `?companyId=${companyId}` : '')),
  exceptions: (params) => request('/api/exceptions?' + new URLSearchParams(params || {})),
  updateException: (id, body) => request(`/api/exceptions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  account: (id) => request(`/api/accounts/${id}`),
  imports: () => request('/api/imports'),
  importFile: (id) => request(`/api/imports/${id}`),
  preview: (id) => request(`/api/imports/${id}/preview`),
  validate: (id) => request(`/api/imports/${id}/validate`, { method: 'POST', body: '{}' }),
  process: (id) => request(`/api/imports/${id}/process`, { method: 'POST', body: '{}' }),
  reprocess: (id) => request(`/api/imports/${id}/reprocess`, { method: 'POST', body: '{}' }),
  errors: (id) => request(`/api/imports/${id}/errors`),
  mapping: (id, mappings) => request(`/api/imports/${id}/mapping`, { method: 'PUT', body: JSON.stringify({ mappings }) }),
  upload: (file, companyId) => {
    if (!companyId) return Promise.reject(new Error('Select the company this Excel file belongs to'));
    const body = new FormData();
    body.append('file', file);
    body.append('companyId', companyId);
    return request('/api/imports/upload', { method: 'POST', body });
  },
  audit: () => request('/api/audit'),
};

export function inr(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
}

export function statusTone(status) {
  if (!status) return 'neutral';
  if (/MATCHED$/.test(status) && !/PARTIAL|MIS/.test(status)) return 'ok';
  if (/HIGH|ERROR|MISMATCH|MISSING/.test(status)) return 'danger';
  if (/WARN|PARTIAL|REVIEW|OPEN/.test(status)) return 'warn';
  if (/COMPLETED|VALIDATED/.test(status)) return 'ok';
  return 'neutral';
}
