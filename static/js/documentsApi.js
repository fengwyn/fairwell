// FAIRWELL — Document Map API client.
// Phase 2: documents persist server-side. Flip USE_DOCUMENTS_API to false
// to fall back to localStorage (kept wired during the transition).

const USE_DOCUMENTS_API = true;

function getCsrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function apiRequest(path, { method = 'GET', body = null } = {}) {
  const headers = {};
  const init = { method, credentials: 'same-origin', headers };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRFToken'] = getCsrfToken() || '';
  }
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers['Accept'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(path, init);
  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch (_) { /* swallow */ }
    const err = new Error(`${method} ${path} → ${resp.status}: ${detail.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  if (resp.status === 204) return null;
  return resp.json();
}

async function apiFetchDocuments() {
  return apiRequest('/api/documents/');
}

async function apiCreateDocument(doc) {
  return apiRequest('/api/documents/', { method: 'POST', body: doc });
}

async function apiUpdateDocument(slug, patch) {
  return apiRequest(`/api/documents/${encodeURIComponent(slug)}/`, { method: 'PATCH', body: patch });
}

async function apiDeleteDocument(slug) {
  return apiRequest(`/api/documents/${encodeURIComponent(slug)}/`, { method: 'DELETE' });
}

async function apiFetchTypes() {
  return apiRequest('/api/types/');
}

async function apiCreateType(t) {
  return apiRequest('/api/types/', { method: 'POST', body: t });
}

async function apiUpdateType(slug, patch) {
  return apiRequest(`/api/types/${encodeURIComponent(slug)}/`, { method: 'PATCH', body: patch });
}

async function apiDeleteType(slug) {
  return apiRequest(`/api/types/${encodeURIComponent(slug)}/`, { method: 'DELETE' });
}

async function apiFetchColors() {
  return apiRequest('/api/colors/');
}

async function apiCreateColor(c) {
  return apiRequest('/api/colors/', { method: 'POST', body: c });
}

async function apiUpdateColor(slug, patch) {
  return apiRequest(`/api/colors/${encodeURIComponent(slug)}/`, { method: 'PATCH', body: patch });
}

async function apiDeleteColor(slug) {
  return apiRequest(`/api/colors/${encodeURIComponent(slug)}/`, { method: 'DELETE' });
}
