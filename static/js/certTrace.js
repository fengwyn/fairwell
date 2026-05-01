// FAIRWELL Cert Trace; client-side PDF cross-reference.
// Given a set of PDFs the user drops in and a subject to trace (part #,
// serial #, heat/lot, spec, etc.), extracts text via PDF.js, searches every
// page, and renders a radial link graph + per-document hit list.
// Able to search via groups
// State is session-only — nothing touches localStorage or the network.



const PDFJS_WORKER_URL      = '/static/lib/pdfjs/pdf.worker.js';
const PDFJS_CMAP_URL        = '/static/lib/pdfjs/cmaps/';
const PDFJS_STANDARD_FONTS  = '/static/lib/pdfjs/standard_fonts/';

// Tesseract.js — loaded lazily on first OCR run (user clicks "OCR" on a
// scanned doc). Default points at unpkg; for fully offline / strict-CSP
// deployments, vendor the dist files under /static/lib/tesseract/ and
// swap the URL below.
const TESSERACT_SRC = 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js';
const OCR_RENDER_SCALE = 2.0;  // Higher = sharper input for OCR, more memory.

const certTraceState = {
  docs: [],           // { id, name, size, pageCount, textLayerPresent, indexing, error, pages, group, label }
  groups: [],         // [{ name, color }] — pre-created and named via the "+ Add Group" chip
  term: '',
  caseSensitive: false,
  looseNumeric: false,
  results: null,      // [{ doc, hits, status }]
  activeGroup: null   // null = scan all docs; '' = only ungrouped; 'X' = only docs with group === 'X'
};

const CERT_DEFAULT_GROUP_COLOR = '#06b6d4';  // matches --accent-cyan

let certNextId = 1;
// Shared PDF.js worker — created once on first parse and reused for every
// subsequent getDocument() call. Without this, PDF.js spins up a new Worker
// per file, and each constructor refetches /static/lib/pdfjs/pdf.worker.js
// (304s, but still a round-trip per upload).
let certPdfWorker = null;
// Lazy-loaded Tesseract.js script + shared OCR worker. Both stay alive for
// the session once the user has run OCR at least once.
let tesseractLoadPromise = null;
let tesseractWorker = null;

function certConfigurePdfJs() {
  if (typeof pdfjsLib === 'undefined') return false;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }
  if (!certPdfWorker && typeof pdfjsLib.PDFWorker === 'function') {
    try {
      certPdfWorker = new pdfjsLib.PDFWorker({ name: 'fairwell-cert-trace' });
    } catch (_) {
      certPdfWorker = null;
    }
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

// === OCR (Tesseract.js) ===

function loadTesseract() {
  if (typeof Tesseract !== 'undefined') return Promise.resolve();
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      tesseractLoadPromise = null;
      reject(new Error('Failed to load Tesseract.js. Check your network connection (or vendor it locally — see TESSERACT_SRC).'));
    };
    document.head.appendChild(s);
  });
  return tesseractLoadPromise;
}

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  await loadTesseract();
  tesseractWorker = await Tesseract.createWorker('eng');
  return tesseractWorker;
}

async function runCertOcr(docId) {
  const doc = certTraceState.docs.find(d => d.id === docId);
  if (!doc || !doc._file || doc.ocrInProgress) return;
  if (!certConfigurePdfJs()) {
    alert('PDF.js failed to load. Refresh the page and try again.');
    return;
  }
  doc.ocrInProgress = true;
  doc.ocrError = null;
  doc.ocrProgress = 'loading…';
  renderCertDocs();
  try {
    const worker = await getTesseractWorker();
    const buf = await doc._file.arrayBuffer();
    const params = {
      data: buf,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_STANDARD_FONTS,
    };
    if (certPdfWorker) params.worker = certPdfWorker;
    const pdf = await pdfjsLib.getDocument(params).promise;
    const ocrPages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      doc.ocrProgress = `${i}/${pdf.numPages}`;
      renderCertDocs();
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      const text = (data && data.text) ? data.text : '';
      const confidence = (data && typeof data.confidence === 'number') ? data.confidence : 0;
      ocrPages.push({ page: i, text, confidence });
      // Free the canvas; high-DPI scans can be tens of MB each.
      canvas.width = 0; canvas.height = 0;
      await page.cleanup();
    }
    pdf.cleanup();
    doc.pages = ocrPages;
    doc.pageCount = ocrPages.length;
    doc.textLayerPresent = ocrPages.some(p => (p.text || '').length > 30);
    doc.ocr = true;
  } catch (e) {
    doc.ocrError = (e && e.message) ? e.message : 'OCR failed';
  } finally {
    doc.ocrInProgress = false;
    doc.ocrProgress = null;
    renderCertDocs();
    if (certTraceState.term) runCertTrace();
  }
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

  // Drops while a named group is selected auto-join that group, so the user
  // can pre-create groups and bulk-assign by switching chips before dropping.
  const activeIsNamed = typeof certTraceState.activeGroup === 'string'
    && certTraceState.activeGroup !== '';
  const initGroup = activeIsNamed ? certTraceState.activeGroup : '';

  for (const file of files) {
    const doc = {
      id: certNextId++,
      name: file.name,
      size: file.size,
      pageCount: 0,
      textLayerPresent: false,
      indexing: true,
      error: null,
      pages: [],
      group: initGroup,
      _file: file    // retained so OCR can re-render the same bytes later
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
  const params = {
    data: buf,
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS
  };
  if (certPdfWorker) params.worker = certPdfWorker;
  const task = pdfjsLib.getDocument(params);
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
  if (!activeCertDocs().length) {
    alert('No documents in the selected group — switch to "All" or pick a group with files in it.');
    return;
  }
  certTraceState.term = term;
  certTraceState.caseSensitive = !!(csEl && csEl.checked);
  certTraceState.looseNumeric = !!(lnEl && lnEl.checked);
  certTraceState.results = certSearchAll(term);
  renderCertGraph();
  renderCertResults();
}

// Docs included in the current trace, filtered by activeGroup. null = all.
function activeCertDocs() {
  const g = certTraceState.activeGroup;
  if (g === null || g === undefined) return certTraceState.docs;
  return certTraceState.docs.filter(d => (d.group || '') === g);
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
  for (const doc of activeCertDocs()) {
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
        const hit = {
          page: p.page,
          pos: found,
          snippet: makeSnippet(raw, found, needle.length)
        };
        if (doc.ocr && typeof p.confidence === 'number') hit.confidence = p.confidence;
        hits.push(hit);
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
  renderCertDocsFilter();
  const list = document.getElementById('certDocsList');
  const countEl = document.getElementById('certDocsCount');
  if (!list) return;
  const allDocs = certTraceState.docs;
  // Header count always reflects total — the filter chips communicate scope.
  if (countEl) countEl.textContent = String(allDocs.length).padStart(2, '0');

  if (!allDocs.length) {
    list.innerHTML = `<div class="cert-docs-empty">No documents yet. Drop PDFs above to begin.</div>`;
    return;
  }

  const visible = activeCertDocs();
  if (!visible.length) {
    const g = certTraceState.activeGroup;
    const label = g === '' ? 'Ungrouped' : `"${g}"`;
    list.innerHTML = `<div class="cert-docs-empty">No documents in ${label}. Pick another group above, or assign one of your files to it via the &#9998; button.</div>`;
    return;
  }

  list.innerHTML = visible.map(d => {
    let badge;
    if (d.indexing) {
      badge = `<span class="cert-doc-badge cert-doc-indexing">Parsing${d.pageCount ? ` ${d.pages.length}/${d.pageCount}` : '…'}</span>`;
    } else if (d.ocrInProgress) {
      badge = `<span class="cert-doc-badge cert-doc-ocr-progress">OCR ${d.ocrProgress || '…'}</span>`;
    } else if (d.ocrError) {
      badge = `<span class="cert-doc-badge cert-doc-error" title="${certAttr(d.ocrError)}">OCR error</span>`;
    } else if (d.error) {
      badge = `<span class="cert-doc-badge cert-doc-error" title="${certAttr(d.error)}">Error</span>`;
    } else if (!d.textLayerPresent) {
      badge = `<span class="cert-doc-badge cert-doc-warn" title="PDF has no text layer — likely a scanned document. Click 'OCR' to extract text on-device (slow, ~10MB one-time download).">No text</span>`;
    } else if (d.ocr) {
      badge = `<span class="cert-doc-badge cert-doc-ocr" title="Text extracted via on-device OCR — accuracy varies by page">${d.pageCount}p OCR</span>`;
    } else {
      badge = `<span class="cert-doc-badge cert-doc-ok">${d.pageCount}p</span>`;
    }
    // OCR is now offered on every parseable doc — even ones with a text layer,
    // since some "text" PDFs are partially raster (mixed digital + scanned).
    // Hidden once the doc is already OCR'd, busy, or errored.
    const showOcrBtn = !d.indexing && !d.ocrInProgress && !d.error && !d.ocr;
    const ocrTitle = d.textLayerPresent
      ? 'Re-extract this PDF via on-device OCR. Useful for partially scanned PDFs whose text layer is incomplete. Files never leave your browser.'
      : 'Extract text from this scanned PDF using on-device OCR. Files never leave your browser.';
    const ocrBtn = showOcrBtn
      ? `<button class="icon-btn-sm cert-doc-ocr-btn" onclick="runCertOcr(${d.id})" title="${certAttr(ocrTitle)}">OCR</button>`
      : '';
    const labelChip = d.label
      ? `<span class="cert-label-chip" title="Temporary label — click the graph node to edit">${esc(d.label)}</span>`
      : '';
    const groupColor = d.group
      ? ((certTraceState.groups.find(g => g.name === d.group) || {}).color || CERT_DEFAULT_GROUP_COLOR)
      : '';
    const groupChip = d.group
      ? `<span class="cert-doc-group-tag" style="--group-color: ${certAttr(groupColor)}" title="Group: ${certAttr(d.group)}">${esc(d.group)}</span>`
      : '';
    return `
      <div class="cert-doc-row">
        <div class="cert-doc-name" title="${certAttr(d.name)}">${esc(d.name)}</div>
        ${labelChip}
        ${groupChip}
        <div class="cert-doc-right">
          ${badge}
          ${ocrBtn}
          <button class="icon-btn-sm" onclick="openCertLabelModal(${d.id})" title="Edit label and group">&#9998;</button>
          <button class="icon-btn-sm delete-btn" onclick="removeCertDoc(${d.id})" title="Remove">×</button>
        </div>
      </div>
    `;
  }).join('');
}

// Render the group filter chipset above the docs list. The "+ Add Group"
// button is always visible so the user can pre-create groups before any
// docs are dropped — selecting a group then dropping files auto-assigns
// them to that group.
function renderCertDocsFilter() {
  const root = document.getElementById('certDocsFilter');
  if (!root) return;
  const groups = certTraceState.groups || [];
  const groupNames = new Set(groups.map(g => g.name));

  // Self-heal: a doc carrying a group name with no entry in `groups`
  // (e.g. older session state, or a stale name) gets its group resurrected
  // with the default cyan so the chip and tag stay coherent.
  certTraceState.docs.forEach(d => {
    if (d.group && !groupNames.has(d.group)) {
      const restored = { name: d.group, color: CERT_DEFAULT_GROUP_COLOR };
      certTraceState.groups.push(restored);
      groupNames.add(restored.name);
    }
  });

  let hasUngrouped = false;
  certTraceState.docs.forEach(d => { if (!d.group) hasUngrouped = true; });

  // Reset stale activeGroup before rendering so the active chip never
  // points at a group that no longer exists.
  const cur = certTraceState.activeGroup;
  if (cur !== null) {
    if (cur === '') {
      if (!hasUngrouped && certTraceState.docs.length > 0) certTraceState.activeGroup = null;
    } else if (!groupNames.has(cur)) {
      certTraceState.activeGroup = null;
    }
  }
  const active = certTraceState.activeGroup;

  const chips = [];
  if (groups.length > 0) {
    chips.push(`<button class="cert-group-chip cert-group-chip-all${active === null ? ' active' : ''}" data-grp="__all__">All</button>`);
    for (const g of groups) {
      const color = g.color || CERT_DEFAULT_GROUP_COLOR;
      const isActive = active === g.name;
      chips.push(
        `<span class="cert-group-chip-wrap" style="--group-color: ${certAttr(color)}">`
        + `<button class="cert-group-chip cert-group-chip-named${isActive ? ' active' : ''}" data-grp="${certAttr(g.name)}">`
        + `<span class="cert-group-chip-dot"></span>${esc(g.name)}`
        + `</button>`
        + `<button class="cert-group-chip-del" data-grp-del="${certAttr(g.name)}" title="Delete group">&times;</button>`
        + `</span>`
      );
    }
    if (hasUngrouped) {
      chips.push(`<button class="cert-group-chip${active === '' ? ' active' : ''}" data-grp="__none__">Ungrouped</button>`);
    }
  }
  chips.push(`<button class="cert-group-chip cert-group-chip-add" id="certAddGroupBtn" title="Create a new group. PDFs dropped while it's selected will join it automatically.">+ Add Group</button>`);

  root.innerHTML = chips.join('');

  root.querySelectorAll('.cert-group-chip[data-grp]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const v = btn.dataset.grp;
      if (v === '__all__') certTraceState.activeGroup = null;
      else if (v === '__none__') certTraceState.activeGroup = '';
      else certTraceState.activeGroup = v;
      renderCertDocs();
      if (certTraceState.term) runCertTrace();
    };
  });
  root.querySelectorAll('.cert-group-chip-del').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteCertGroup(btn.dataset.grpDel);
    };
  });
  const addBtn = root.querySelector('#certAddGroupBtn');
  if (addBtn) addBtn.onclick = () => openCertAddGroupModal();
}

function openCertAddGroupModal() {
  const body = `
    <div style="margin-bottom:14px;">
      <label class="review-section-label" style="margin-bottom:6px; display:block;">Group name</label>
      <input type="text" class="modal-input" id="certNewGroupName"
             maxlength="40" autocomplete="off"
             placeholder="e.g. FAIR Packet 1, Drawings, Material Certs">
    </div>
    <div style="margin-bottom:6px;">
      <label class="review-section-label" style="margin-bottom:6px; display:block;">Color</label>
      <input type="color" class="cert-color-input" id="certNewGroupColor" value="${CERT_DEFAULT_GROUP_COLOR}">
      <div class="modal-hint" style="margin-top:8px;">
        Used as the group chip and per-file tag color. Default cyan if you don't change it.
        After saving, the group becomes selected — drop files and they'll automatically join this group.
      </div>
    </div>
  `;
  openModal('Add Group', body, () => {
    const name = document.getElementById('certNewGroupName').value.trim();
    const color = document.getElementById('certNewGroupColor').value || CERT_DEFAULT_GROUP_COLOR;
    if (!name) { alert('Group name is required.'); return; }
    if (certTraceState.groups.some(g => g.name === name)) {
      alert('A group with that name already exists.');
      return;
    }
    certTraceState.groups.push({ name, color });
    certTraceState.activeGroup = name;
    renderCertDocs();
    closeModal();
  });
  setTimeout(() => {
    const inp = document.getElementById('certNewGroupName');
    if (inp) inp.focus();
  }, 0);
}

function deleteCertGroup(name) {
  if (!name) return;
  const docsInGroup = certTraceState.docs.filter(d => d.group === name).length;
  const msg = docsInGroup
    ? `Delete group "${name}"? Its ${docsInGroup} document${docsInGroup === 1 ? '' : 's'} will become Ungrouped (the files themselves stay).`
    : `Delete group "${name}"?`;
  if (!confirm(msg)) return;
  certTraceState.groups = certTraceState.groups.filter(g => g.name !== name);
  certTraceState.docs.forEach(d => { if (d.group === name) d.group = ''; });
  if (certTraceState.activeGroup === name) certTraceState.activeGroup = null;
  renderCertDocs();
  if (certTraceState.term) runCertTrace();
}

function openCertLabelModal(docId) {
  const doc = certTraceState.docs.find(d => d.id === docId);
  if (!doc) return;
  // Suggest existing groups so the user can quickly reuse one rather than
  // re-typing — typos would split the same intended group across two chips.
  const existingGroups = Array.from(new Set([
    ...certTraceState.groups.map(g => g.name),
    ...certTraceState.docs.map(d => d.group).filter(Boolean),
  ])).sort();
  const groupOpts = existingGroups.map(g =>
    `<option value="${certAttr(g)}"></option>`
  ).join('');
  const body = `
    <div style="margin-bottom:14px;">
      <label class="review-section-label" style="margin-bottom:6px; display:block;">Label for
        <span style="color:var(--text-primary); font-weight:600;">${esc(doc.name)}</span>
      </label>
      <input type="text" class="modal-input" id="certLabelInput"
             value="${certAttr(doc.label || '')}"
             placeholder="e.g. Form 1, PO, CoC — leave empty to keep the file name"
             maxlength="60" autocomplete="off">
      <div class="modal-hint" style="margin-top:8px;">
        Display label shown in the Link Graph and next to the file name in Hits. Doesn't rename the file. Session-only.
      </div>
    </div>
    <div style="margin-bottom:10px;">
      <label class="review-section-label" style="margin-bottom:6px; display:block;">Group</label>
      <input type="text" class="modal-input" id="certGroupInput"
             list="certGroupSuggestions"
             value="${certAttr(doc.group || '')}"
             placeholder="e.g. FAIR Packet 1, Drawings, Material Certs — leave empty for ungrouped"
             maxlength="40" autocomplete="off">
      <datalist id="certGroupSuggestions">${groupOpts}</datalist>
      <div class="modal-hint" style="margin-top:8px;">
        Groups let you trace a subset of documents at a time. Pick one from the chips above the file list to scope the next trace.
      </div>
    </div>
  `;
  openModal(`Document Settings`, body, () => {
    const labelVal = document.getElementById('certLabelInput').value.trim();
    const groupVal = document.getElementById('certGroupInput').value.trim();
    if (labelVal) doc.label = labelVal; else delete doc.label;
    // Auto-register a typed-but-unknown group name with the default cyan
    // color, so the chip and per-doc tag stay in sync. Use Add Group for
    // a custom color.
    if (groupVal && !certTraceState.groups.some(g => g.name === groupVal)) {
      certTraceState.groups.push({ name: groupVal, color: CERT_DEFAULT_GROUP_COLOR });
    }
    doc.group = groupVal;
    renderCertDocs();
    if (certTraceState.results) {
      // Group change can shift which docs are in scope — re-run search if
      // a term is active so results stay coherent with the chip selection.
      if (certTraceState.term) runCertTrace();
      else { renderCertGraph(); renderCertResults(); }
    }
    closeModal();
  });
  setTimeout(() => {
    const inp = document.getElementById('certLabelInput');
    if (inp) { inp.focus(); inp.select(); }
  }, 0);
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
    const ocrDoc = !!node.doc.ocr;
    const strength = hit ? 1 + Math.log(1 + node.hits.length) : 0;
    const strokeWidth = hit ? (1.5 + strength * 1.2) : 1.2;
    let stroke = 'var(--text-muted)';
    if (hit) stroke = ocrDoc ? 'var(--accent-purple)' : 'var(--accent-blue)';
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
    const ocrDoc = !!node.doc.ocr;
    let fill = 'var(--bg-card)';
    let stroke = 'var(--border)';
    if (hit) {
      fill = ocrDoc ? 'rgba(139,92,246,0.14)' : 'rgba(59,130,246,0.14)';
      stroke = ocrDoc ? 'var(--accent-purple)' : 'var(--accent-blue)';
    }
    else if (errored) { fill = 'rgba(244,63,94,0.14)'; stroke = 'var(--accent-rose)'; }
    else if (noText) { fill = 'rgba(245,158,11,0.12)'; stroke = 'var(--accent-amber)'; }
    const displayName = node.doc.label || node.doc.name;
    const label = displayName.length > 28 ? displayName.slice(0, 26) + '…' : displayName;
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
    const labelTooltip = node.doc.label
      ? `${node.doc.label} — click to edit (file: ${node.doc.name})`
      : `${node.doc.name} — click to set a temporary label`;
    return `
      <g class="cert-graph-node cert-graph-node-${node.status}${ocrDoc ? ' cert-graph-node-ocr' : ''}">
        <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <text x="${node.x}" y="${node.y + 5}" class="cert-node-count" text-anchor="middle">${countText}</text>
        <text x="${labelX}" y="${labelY}" class="cert-node-label ${node.doc.label ? 'cert-node-label-custom' : ''}" text-anchor="${textAnchor}" onclick="openCertLabelModal(${node.doc.id})"><title>${esc(labelTooltip)}</title>${esc(label)}</text>
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
      ${results.some(r => r.doc.ocr) ? '<span class="cert-legend-item"><span class="cert-legend-swatch cert-legend-ocr"></span> OCR-derived</span>' : ''}
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
    const cls = 'cert-result-' + r.status + (r.doc.ocr ? ' cert-result-ocr' : '');
    const hitsShown = r.hits.slice(0, 6);
    const hitsHtml = hitsShown.map(h => {
      const conf = (typeof h.confidence === 'number')
        ? `<span class="cert-hit-conf" title="OCR confidence on page ${h.page}">${Math.round(h.confidence)}%</span>`
        : '';
      return `
        <div class="cert-hit">
          <span class="cert-hit-page">p.${h.page}</span>
          ${conf}
          <span class="cert-hit-text">${esc(h.snippet.pre)}<mark>${esc(h.snippet.mid)}</mark>${esc(h.snippet.post)}</span>
        </div>
      `;
    }).join('');
    const moreHits = r.hits.length > hitsShown.length
      ? `<div class="cert-hit-more">… and ${r.hits.length - hitsShown.length} more hit${r.hits.length - hitsShown.length === 1 ? '' : 's'}</div>`
      : '';
    const statusNote = r.status === 'notext' ? `<div class="cert-result-note">PDF has no text layer — likely scanned. This version does not OCR.</div>`
                   : r.status === 'error' ? `<div class="cert-result-note">${esc(r.doc.error || 'Parse error')}</div>`
                   : r.status === 'indexing' ? `<div class="cert-result-note">Still parsing — re-run trace when done.</div>`
                   : '';
    const labelChip = r.doc.label
      ? `<span class="cert-label-chip" title="Temporary label">${esc(r.doc.label)}</span>`
      : '';
    const ocrTag = r.doc.ocr
      ? `<span class="cert-ocr-tag" title="Text extracted via on-device OCR">OCR</span>`
      : '';
    return `
      <div class="cert-result-row ${cls}">
        <div class="cert-result-head">
          <span class="cert-result-icon">${icon}</span>
          <span class="cert-result-name">${esc(r.doc.name)}</span>
          ${ocrTag}
          ${labelChip}
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
  // Warm the shared PDF.js worker now so the first file drop doesn't pay the
  // worker-script fetch latency.
  certConfigurePdfJs();
}

// Hook into the app's render cycle and run once on DOM ready (whichever fires
// first wins; both are idempotent for Cert Trace).
document.addEventListener('DOMContentLoaded', initCertTrace);
