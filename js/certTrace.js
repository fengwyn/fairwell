// FAIRWELL Cert Trace — client-side PDF cross-reference.
// Given a set of PDFs the user drops in and a subject to trace (part #,
// serial #, heat/lot, spec, etc.), extracts text via PDF.js, searches every
// page, and renders a radial link graph + per-document hit list.
// State is session-only — nothing touches localStorage or the network.

const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const certTraceState = {
  docs: [],           // { id, name, size, pageCount, textLayerPresent, indexing, error, pages }
  term: '',
  caseSensitive: false,
  looseNumeric: false,
  results: null       // [{ doc, hits, status }]
};

let certNextId = 1;

function certConfigurePdfJs() {
  if (typeof pdfjsLib === 'undefined') return false;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }
  return true;
}

// Attribute-safe encode (same rules as revAttr — duplicated to avoid load-order coupling).
function certAttr(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;');
}

// === INPUT ===

function certBindControls() {
  const fileInput = document.getElementById('certFileInput');
  const browseBtn = document.getElementById('certBrowseBtn');
  const dropZone = document.getElementById('certDropZone');
  const termInput = document.getElementById('certTermInput');
  const runBtn = document.getElementById('certRunBtn');
  const clearBtn = document.getElementById('certClearBtn');

  if (fileInput) fileInput.onchange = (e) => {
    addCertFiles(e.target.files);
    e.target.value = '';
  };
  if (browseBtn) browseBtn.onclick = () => fileInput && fileInput.click();

  if (dropZone) {
    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, (e) => {
      prevent(e);
      dropZone.classList.add('drag-over');
    }));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, (e) => {
      prevent(e);
      if (ev === 'dragleave' && e.target !== dropZone) return;
      dropZone.classList.remove('drag-over');
    }));
    dropZone.addEventListener('drop', (e) => {
      prevent(e);
      dropZone.classList.remove('drag-over');
      addCertFiles(e.dataTransfer.files);
    });
    // Clicking the zone (outside the browse button) also opens the picker
    dropZone.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'certBrowseBtn') return;
      if (fileInput) fileInput.click();
    });
  }

  if (termInput) termInput.onkeydown = (e) => {
    if (e.key === 'Enter') runCertTrace();
  };
  if (runBtn) runBtn.onclick = runCertTrace;
  if (clearBtn) clearBtn.onclick = clearAllCertDocs;
}

async function addCertFiles(fileList) {
  if (!certConfigurePdfJs()) {
    alert('PDF.js failed to load. Check your network connection and refresh.');
    return;
  }
  const files = Array.from(fileList || []).filter(f => {
    const ok = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    return ok;
  });
  if (!files.length) return;

  for (const file of files) {
    const doc = {
      id: certNextId++,
      name: file.name,
      size: file.size,
      pageCount: 0,
      textLayerPresent: false,
      indexing: true,
      error: null,
      pages: []
    };
    certTraceState.docs.push(doc);
  }
  renderCertDocs();

  // Index sequentially — PDF.js runs extraction off the main thread via its
  // own worker, so parallelism from us is unnecessary and just bloats memory.
  const toIndex = certTraceState.docs.filter(d => d.indexing && !d.pages.length);
  const pending = files.map((file, i) => ({ file, doc: toIndex[i] })).filter(p => p.doc);
  for (const { file, doc } of pending) {
    try {
      await indexCertPdf(file, doc);
    } catch (e) {
      doc.error = (e && e.message) ? e.message : 'Failed to parse PDF';
    } finally {
      doc.indexing = false;
      renderCertDocs();
      // If the user has already run a trace, refresh results as new docs land
      if (certTraceState.term) runCertTrace();
    }
  }
}

async function indexCertPdf(file, doc) {
  const buf = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({ data: buf });
  const pdf = await task.promise;
  doc.pageCount = pdf.numPages;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Insert a space between text items; PDF.js items are positional fragments
    const text = content.items.map(it => it.str || '').join(' ');
    pages.push({ page: i, text });
    // Allow the doc row to reflect progress mid-parse for big files
    if (pdf.numPages > 20 && i % 10 === 0) renderCertDocs();
    await page.cleanup();
  }
  pdf.cleanup();
  doc.pages = pages;
  const totalChars = pages.reduce((a, p) => a + (p.text || '').length, 0);
  doc.textLayerPresent = totalChars > 30;
}

function removeCertDoc(id) {
  certTraceState.docs = certTraceState.docs.filter(d => d.id !== id);
  renderCertDocs();
  if (certTraceState.term) runCertTrace();
}

function clearAllCertDocs() {
  if (!certTraceState.docs.length && !certTraceState.results) return;
  if (!confirm('Remove all documents and clear the trace?')) return;
  certTraceState.docs = [];
  certTraceState.results = null;
  certTraceState.term = '';
  const termInput = document.getElementById('certTermInput');
  if (termInput) termInput.value = '';
  renderCertTrace();
}

// === SEARCH ===

function runCertTrace() {
  const termInput = document.getElementById('certTermInput');
  const csEl = document.getElementById('certCaseSensitive');
  const lnEl = document.getElementById('certLooseNumeric');
  const term = termInput ? termInput.value.trim() : '';
  if (!term) { alert('Enter a subject to trace first.'); return; }
  if (!certTraceState.docs.length) { alert('Add at least one PDF first.'); return; }
  certTraceState.term = term;
  certTraceState.caseSensitive = !!(csEl && csEl.checked);
  certTraceState.looseNumeric = !!(lnEl && lnEl.checked);
  certTraceState.results = certSearchAll(term);
  renderCertGraph();
  renderCertResults();
}

function certNormalize(s, caseSensitive, loose) {
  let out = s;
  if (!caseSensitive) out = out.toLowerCase();
  if (loose) {
    out = out
      .replace(/[Oo]/g, '0')
      .replace(/[Il|]/g, '1');
  }
  return out;
}

function certSearchAll(term) {
  const results = [];
  const needle = certNormalize(term, certTraceState.caseSensitive, certTraceState.looseNumeric);
  for (const doc of certTraceState.docs) {
    if (doc.indexing) { results.push({ doc, hits: [], status: 'indexing' }); continue; }
    if (doc.error) { results.push({ doc, hits: [], status: 'error' }); continue; }
    if (!doc.textLayerPresent) { results.push({ doc, hits: [], status: 'notext' }); continue; }
    const hits = [];
    for (const p of doc.pages) {
      const raw = p.text || '';
      const hay = certNormalize(raw, certTraceState.caseSensitive, certTraceState.looseNumeric);
      let i = 0;
      while (i < hay.length) {
        const found = hay.indexOf(needle, i);
        if (found < 0) break;
        hits.push({
          page: p.page,
          pos: found,
          snippet: makeSnippet(raw, found, needle.length)
        });
        i = found + needle.length;
        if (hits.length > 500) break;
      }
      if (hits.length > 500) break;
    }
    results.push({ doc, hits, status: hits.length ? 'hit' : 'miss' });
  }
  return results;
}

function makeSnippet(text, pos, len) {
  const start = Math.max(0, pos - 60);
  const end = Math.min(text.length, pos + len + 60);
  const pre = (start > 0 ? '…' : '') + text.slice(start, pos);
  const mid = text.slice(pos, pos + len);
  const post = text.slice(pos + len, end) + (end < text.length ? '…' : '');
  return { pre, mid, post };
}

// === RENDER ===

function renderCertTrace() {
  renderCertDocs();
  renderCertGraph();
  renderCertResults();
}

function renderCertDocs() {
  const list = document.getElementById('certDocsList');
  const countEl = document.getElementById('certDocsCount');
  if (!list) return;
  const docs = certTraceState.docs;
  if (countEl) countEl.textContent = String(docs.length).padStart(2, '0');

  if (!docs.length) {
    list.innerHTML = `<div class="cert-docs-empty">No documents yet. Drop PDFs above to begin.</div>`;
    return;
  }

  list.innerHTML = docs.map(d => {
    let badge;
    if (d.indexing) {
      badge = `<span class="cert-doc-badge cert-doc-indexing">Parsing${d.pageCount ? ` ${d.pages.length}/${d.pageCount}` : '…'}</span>`;
    } else if (d.error) {
      badge = `<span class="cert-doc-badge cert-doc-error" title="${certAttr(d.error)}">Error</span>`;
    } else if (!d.textLayerPresent) {
      badge = `<span class="cert-doc-badge cert-doc-warn" title="PDF has no text layer — likely a scanned document. OCR is not supported in this version.">No text</span>`;
    } else {
      badge = `<span class="cert-doc-badge cert-doc-ok">${d.pageCount}p</span>`;
    }
    return `
      <div class="cert-doc-row">
        <div class="cert-doc-name" title="${certAttr(d.name)}">${esc(d.name)}</div>
        <div class="cert-doc-right">
          ${badge}
          <button class="icon-btn-sm delete-btn" onclick="removeCertDoc(${d.id})" title="Remove">×</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderCertGraph() {
  const graph = document.getElementById('certGraph');
  const tag = document.getElementById('certVerdictTag');
  if (!graph) return;

  const results = certTraceState.results;
  if (!results || !certTraceState.term) {
    if (tag) tag.textContent = '';
    graph.innerHTML = `
      <div class="cert-graph-empty">
        <div class="cert-graph-empty-icon">∿</div>
        <div class="cert-graph-empty-title">Nothing traced yet</div>
        <p>Add one or more PDFs, type a subject above (part number, serial, heat, spec…), and click <strong>Trace →</strong>. Each document becomes a node around the subject; solid lines mean the term was found, dashed means it's missing.</p>
      </div>
    `;
    return;
  }

  if (!results.length) {
    graph.innerHTML = `<div class="cert-graph-empty">No documents to trace.</div>`;
    return;
  }

  const W = 880;
  const H = 520;
  const cx = W / 2;
  const cy = H / 2;
  const termRadius = 68;
  const nodeRadius = 24;
  const ringRadius = Math.min(W, H) / 2 - 90;
  const n = results.length;

  const nodes = results.map((r, i) => {
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI / n);
    const x = cx + ringRadius * Math.cos(angle);
    const y = cy + ringRadius * Math.sin(angle);
    return Object.assign({}, r, { angle, x, y });
  });

  const edges = nodes.map(node => {
    const hit = node.status === 'hit';
    const errored = node.status === 'error';
    const indexing = node.status === 'indexing';
    const noText = node.status === 'notext';
    const strength = hit ? 1 + Math.log(1 + node.hits.length) : 0;
    const strokeWidth = hit ? (1.5 + strength * 1.2) : 1.2;
    let stroke = 'var(--text-muted)';
    if (hit) stroke = 'var(--accent-blue)';
    else if (errored) stroke = 'var(--accent-rose)';
    else if (noText) stroke = 'var(--accent-amber)';
    else if (indexing) stroke = 'var(--accent-cyan)';
    const dashArray = hit ? '' : '6 6';
    const opacity = hit ? 0.9 : 0.55;
    const dx = node.x - cx;
    const dy = node.y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const x1 = cx + termRadius * ux;
    const y1 = cy + termRadius * uy;
    const x2 = node.x - nodeRadius * ux;
    const y2 = node.y - nodeRadius * uy;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                  stroke="${stroke}" stroke-width="${strokeWidth}"
                  stroke-dasharray="${dashArray}" opacity="${opacity}"
                  stroke-linecap="round"/>`;
  }).join('');

  const nodeEls = nodes.map(node => {
    const hit = node.status === 'hit';
    const errored = node.status === 'error';
    const noText = node.status === 'notext';
    let fill = 'var(--bg-card)';
    let stroke = 'var(--border)';
    if (hit) { fill = 'rgba(59,130,246,0.14)'; stroke = 'var(--accent-blue)'; }
    else if (errored) { fill = 'rgba(244,63,94,0.14)'; stroke = 'var(--accent-rose)'; }
    else if (noText) { fill = 'rgba(245,158,11,0.12)'; stroke = 'var(--accent-amber)'; }
    const label = node.doc.name.length > 28 ? node.doc.name.slice(0, 26) + '…' : node.doc.name;
    const rightSide = node.x > cx + 4;
    const leftSide = node.x < cx - 4;
    const labelX = rightSide ? node.x + 30 : (leftSide ? node.x - 30 : node.x);
    const labelY = rightSide || leftSide ? node.y + 4 : (node.y < cy ? node.y - 30 : node.y + 40);
    const textAnchor = rightSide ? 'start' : (leftSide ? 'end' : 'middle');
    const countText = hit ? String(node.hits.length)
                    : errored ? '!'
                    : noText ? '—'
                    : node.status === 'indexing' ? '…'
                    : '0';
    return `
      <g class="cert-graph-node cert-graph-node-${node.status}">
        <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <text x="${node.x}" y="${node.y + 5}" class="cert-node-count" text-anchor="middle">${countText}</text>
        <text x="${labelX}" y="${labelY}" class="cert-node-label" text-anchor="${textAnchor}" title="${certAttr(node.doc.name)}">${esc(label)}</text>
      </g>
    `;
  }).join('');

  // Verdict
  const total = results.length;
  const hitCount = results.filter(r => r.status === 'hit').length;
  const missCount = results.filter(r => r.status === 'miss').length;
  const problemCount = results.filter(r => r.status === 'error' || r.status === 'notext').length;
  let verdict = '';
  let verdictClass = '';
  if (hitCount === total) {
    verdict = `Present in all ${total} document${total === 1 ? '' : 's'}`;
    verdictClass = 'verdict-ok';
  } else if (missCount >= 2) {
    verdict = `Missing from ${missCount} of ${total} documents`;
    verdictClass = 'verdict-bad';
  } else if (missCount === 1) {
    verdict = `Missing from 1 document`;
    verdictClass = 'verdict-warn';
  } else if (problemCount) {
    verdict = `${problemCount} document(s) unreadable`;
    verdictClass = 'verdict-warn';
  }
  if (tag) {
    tag.textContent = verdict;
    tag.className = 'cert-pane-count ' + verdictClass;
  }

  graph.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="cert-graph-svg" aria-label="Link graph">
      ${edges}
      <g class="cert-graph-center">
        <circle cx="${cx}" cy="${cy}" r="${termRadius}" fill="rgba(245,158,11,0.12)" stroke="var(--accent-amber)" stroke-width="2"/>
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="cert-center-eyebrow">SUBJECT</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" class="cert-center-label">${esc(truncCenter(certTraceState.term, 14))}</text>
      </g>
      ${nodeEls}
    </svg>
    <div class="cert-graph-legend">
      <span class="cert-legend-item"><span class="cert-legend-swatch cert-legend-hit"></span> Present</span>
      <span class="cert-legend-item"><span class="cert-legend-swatch cert-legend-miss"></span> Missing</span>
      <span class="cert-legend-item"><span class="cert-legend-swatch cert-legend-notext"></span> No text layer</span>
      <span class="cert-legend-item"><span class="cert-legend-swatch cert-legend-err"></span> Error</span>
    </div>
  `;
}

function truncCenter(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function renderCertResults() {
  const root = document.getElementById('certResults');
  if (!root) return;
  const results = certTraceState.results;
  if (!results) {
    root.innerHTML = `<div class="cert-results-empty">Results will appear here after tracing.</div>`;
    return;
  }

  const sorted = results.slice().sort((a, b) => {
    const order = { hit: 0, miss: 3, notext: 1, error: 2, indexing: 4 };
    const d = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (d !== 0) return d;
    return b.hits.length - a.hits.length;
  });

  root.innerHTML = sorted.map(r => {
    const icon = r.status === 'hit' ? '✓'
               : r.status === 'miss' ? '✗'
               : r.status === 'notext' ? '⚠'
               : r.status === 'error' ? '!'
               : '…';
    const cls = 'cert-result-' + r.status;
    const hitsShown = r.hits.slice(0, 6);
    const hitsHtml = hitsShown.map(h => `
      <div class="cert-hit">
        <span class="cert-hit-page">p.${h.page}</span>
        <span class="cert-hit-text">${esc(h.snippet.pre)}<mark>${esc(h.snippet.mid)}</mark>${esc(h.snippet.post)}</span>
      </div>
    `).join('');
    const moreHits = r.hits.length > hitsShown.length
      ? `<div class="cert-hit-more">… and ${r.hits.length - hitsShown.length} more hit${r.hits.length - hitsShown.length === 1 ? '' : 's'}</div>`
      : '';
    const statusNote = r.status === 'notext' ? `<div class="cert-result-note">PDF has no text layer — likely scanned. This version does not OCR.</div>`
                   : r.status === 'error' ? `<div class="cert-result-note">${esc(r.doc.error || 'Parse error')}</div>`
                   : r.status === 'indexing' ? `<div class="cert-result-note">Still parsing — re-run trace when done.</div>`
                   : '';
    return `
      <div class="cert-result-row ${cls}">
        <div class="cert-result-head">
          <span class="cert-result-icon">${icon}</span>
          <span class="cert-result-name">${esc(r.doc.name)}</span>
          <span class="cert-result-count">${r.hits.length} hit${r.hits.length === 1 ? '' : 's'}</span>
        </div>
        ${statusNote}
        ${hitsHtml}
        ${moreHits}
      </div>
    `;
  }).join('');
}

// === INIT ===
function initCertTrace() {
  certBindControls();
  renderCertTrace();
}

// Hook into the app's render cycle and run once on DOM ready (whichever fires
// first wins; both are idempotent for Cert Trace).
document.addEventListener('DOMContentLoaded', initCertTrace);
