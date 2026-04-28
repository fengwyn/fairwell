// FAIRWELL: Catalog API client.
// Phase 4: Per-user catalog blobs (hierarchy, decisionFlow, formNFields,
// reviewTurnbacks, reviewRefMeta, descriptions, specialChars) persist
// server-side. Flip USE_CATALOG_API to false to fall back to localStorage
// (kept wired during the transition).
//
// Depends on documentsApi.js for `apiRequest` (loaded first in index.html).

// Driven by the same Cloud Sync toggle as USE_DOCUMENTS_API — they flip together.
const USE_CATALOG_API = (function () {
  try { return localStorage.getItem('fairwell_cloud_sync') === 'true'; }
  catch (_) { return false; }
})();

async function apiFetchCatalog() {
  return apiRequest('/api/catalog/');
}

async function apiPatchCatalog(body) {
  return apiRequest('/api/catalog/', { method: 'PATCH', body });
}

async function apiPatchCatalogKind(kind, data) {
  return apiPatchCatalog({ [kind]: data });
}
