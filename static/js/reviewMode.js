// FAIRWELL Review Mode — batch turnback composer.
// Catalog and reference-doc metadata live in appData (loaded from data.json or
// edited in-app). The public codebase ships empty; proprietary turnbacks are
// added by the user or loaded via "Load Data".

const REVIEW_DOCS = [
  "Form 1", "Form 2", "Form 3", "CoC", "Part Marking", "Drawing",
  "PO", "QC1700", "FAIR", "Check List", "MPN", "No Findings"
];
const REVIEW_PROGRAMS = ["P&C", "Safety", "Cast/Forge"];
const REVIEW_REF_TONES = ["primary", "secondary", "warn"];

// Ephemeral UI state (not persisted — findings basket lives for the session).
const reviewState = {
  query: "",
  docFilter: "all",
  subFilter: "all",
  program: "all",
  selectedId: null,
  placeholder: "",
  findings: [],
  panelView: "list",   // list | export
  findingSearch: "",   // free-text filter over the findings basket
  editingDesc: false,  // inline-edit state for the Standardized Turnback Text
  meta: { fairId: "", partNumber: "", supplierCode: "", supplierName: "", enteredBy: "" }
};

// Accessors
function reviewCatalog() { return (appData && appData.reviewTurnbacks) || []; }
function reviewRefMeta() { return (appData && appData.reviewRefMeta) || {}; }

// Attribute-safe encode for single-quoted onclick="" values.
function revAttr(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;');
}

// === RULES ENGINE ===
function reviewEvaluateRules(selected) {
  const out = [];
  if (!selected) return out;
  const catLower = (selected.cat || "").toLowerCase();
  const blkLower = (selected.blk || "").toLowerCase();
  if (selected.doc === "Form 1" &&
      (/block 24|block 25/.test(catLower) || /24|25/.test(blkLower))) {
    out.push({
      kind: "block",
      title: "CUSTOMER APPROVAL RULE",
      body: "Form 1 Blocks 24 & 25 are CUSTOMER APPROVAL fields. If empty, you are the approver — DO NOT issue a turnback on 24/25."
    });
  }
  if ((selected.doc === "Form 2" || selected.doc === "Form 3") &&
      selected.refs && selected.refs["Report 80/85"]) {
    out.push({
      kind: "warn",
      title: "CONTROLLED SOURCE CHECK",
      body: "This turnback references Report 80/85 — verify the supplier against the controlled-source list in HSM17 before issuing."
    });
  }
  if (selected.sub && selected.sub.startsWith("L2")) {
    const impact = selected.sub.includes("MRD") ? "documentation completeness"
                 : selected.sub.includes("Certification") ? "certification chain"
                 : "characteristic accountability";
    out.push({
      kind: "sev",
      title: "LEVEL 2 SEVERITY",
      body: `Subcategory: ${selected.sub}. Elevated severity — impacts ${impact}.`
    });
  }
  if (reviewState.findings.some(f => f.tid === selected.id)) {
    out.push({
      kind: "info",
      title: "ALREADY IN FINDINGS",
      body: "This turnback is already in your findings basket. Adding again will create a duplicate."
    });
  }
  const activeForm =
    reviewState.docFilter === "Form 1" || reviewState.docFilter === "Form 2" || reviewState.docFilter === "Form 3"
      ? reviewState.docFilter : null;
  if (activeForm && selected.doc !== activeForm && selected.doc !== "ALL") {
    out.push({
      kind: "info",
      title: "CROSS-FORM SELECTION",
      body: `You're on ${activeForm} but this turnback is scoped to ${selected.doc}. Confirm before adding.`
    });
  }
  return out;
}

// === FILTERING ===
function reviewFiltered() {
  const q = reviewState.query.toLowerCase().trim();
  return reviewCatalog().filter(t => {
    if (reviewState.docFilter !== "all" && t.doc !== reviewState.docFilter) return false;
    if (reviewState.subFilter !== "all" && !(t.sub || '').startsWith(reviewState.subFilter)) return false;
    if (reviewState.program && reviewState.program !== 'all' && (t.prog || []).length > 0 && !(t.prog || []).includes(reviewState.program)) return false;
    if (q) {
      const hay = `${t.id} ${t.ttl || ''} ${t.desc || ''} ${t.cat || ''} ${t.blk || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function reviewDocCounts() {
  const c = {};
  reviewCatalog().forEach(t => { c[t.doc] = (c[t.doc] || 0) + 1; });
  return c;
}

// === RENDER: filters ===
function renderReviewChips() {
  const docBar = document.getElementById('revDocChips');
  const sevBar = document.getElementById('revSevChips');
  const progBar = document.getElementById('revProgramChips');
  if (!docBar || !sevBar || !progBar) return;

  const counts = reviewDocCounts();
  const docBtns = [['all', 'All', null]]
    .concat(REVIEW_DOCS.filter(d => counts[d]).map(d => [d, d, counts[d]]));

  docBar.innerHTML = docBtns.map(([key, lbl, count]) => `
    <button class="review-chip ${reviewState.docFilter === key ? 'active' : ''}"
            onclick="revSetFilter('doc', '${revAttr(key)}')">
      ${esc(lbl)}${count != null ? `<span class="review-chip-count">${count}</span>` : ''}
    </button>
  `).join('');

  sevBar.innerHTML = [
    ['all', 'All'],
    ['L2', 'L2 — Accountability'],
    ['L3', 'L3 — Procedure/Format']
  ].map(([key, lbl]) => `
    <button class="review-chip ${reviewState.subFilter === key ? 'active' : ''} ${key === 'L2' ? 'review-chip-warn' : ''}"
            onclick="revSetFilter('sub', '${revAttr(key)}')">${esc(lbl)}</button>
  `).join('');

  const progBtns = [['all', 'All']].concat(REVIEW_PROGRAMS.map(p => [p, p]));
  progBar.innerHTML = progBtns.map(([key, lbl]) => `
    <button class="review-chip ${reviewState.program === key ? 'active' : ''}"
            onclick="revSetFilter('prog', '${revAttr(key)}')">${esc(lbl)}</button>
  `).join('');
}

function revSetFilter(kind, value) {
  if (kind === 'doc') reviewState.docFilter = value;
  else if (kind === 'sub') reviewState.subFilter = value;
  else if (kind === 'prog') reviewState.program = value;
  renderReviewChips();
  renderReviewList();
  renderReviewComposer();
}

// === RENDER: library list ===
function renderReviewList() {
  const list = document.getElementById('revList');
  const countEl = document.getElementById('revLibCount');
  if (!list) return;
  const cat = reviewCatalog();
  const filtered = reviewFiltered();
  if (countEl) countEl.textContent = `${filtered.length}/${cat.length}`;

  if (cat.length === 0) {
    list.innerHTML = `
      <div class="review-empty">
        The turnback library is empty.<br>
        Click <strong>+ Add Turnback</strong> to create one, or use <strong>Load Data</strong> in the toolbar to import a data.json file.
      </div>`;
    return;
  }
  if (filtered.length === 0) {
    list.innerHTML = `<div class="review-empty">No matches — adjust filters or clear search.</div>`;
    return;
  }

  list.innerHTML = filtered.map(t => {
    const isActive = t.id === reviewState.selectedId;
    const blk = t.blk || '';
    const blkLabel = blk && blk.toUpperCase() !== 'ALL'
      ? `<span class="rev-tb-blk">Blk ${esc(blk)}</span>`
      : (blk ? `<span class="rev-tb-blk rev-tb-blk-all">ALL</span>` : '');
    return `
      <div class="rev-tb-row ${isActive ? 'active' : ''}" onclick="revSelectTurnback(${JSON.stringify(t.id)})">
        <div class="rev-tb-row-head">
          <span class="rev-tb-id">TB-${esc(String(t.id))}</span>
          <div class="rev-tb-row-right">
            ${renderSubBadge(t.sub)}
            <span class="rev-tb-actions">
              <button class="icon-btn-sm" title="Edit turnback"
                      onclick="event.stopPropagation(); openReviewTbModal(${JSON.stringify(t.id)})">&#9998;</button>
              <button class="icon-btn-sm delete-btn" title="Delete turnback"
                      onclick="event.stopPropagation(); deleteReviewTurnback(${JSON.stringify(t.id)})">&times;</button>
            </span>
          </div>
        </div>
        <div class="rev-tb-ttl">${esc(t.ttl || '(untitled)')}</div>
        <div class="rev-tb-meta">
          <span>${esc(t.doc || '')}</span>${blkLabel}
          <span class="rev-tb-sep">//</span>
          <span class="rev-tb-cat">${esc(t.cat || '')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSubBadge(sub) {
  if (!sub) return '';
  const isL2 = sub.startsWith('L2');
  const short = sub.split(' - ')[0];
  return `<span class="rev-sub-badge ${isL2 ? 'rev-sub-l2' : 'rev-sub-l3'}">${esc(short)}</span>`;
}

function revSelectTurnback(id) {
  reviewState.selectedId = id;
  reviewState.placeholder = "";
  reviewState.editingDesc = false;
  renderReviewList();
  renderReviewComposer();
}

// === RENDER: composer ===
function renderReviewComposer() {
  const root = document.getElementById('revComposer');
  const tag = document.getElementById('revComposerTag');
  if (!root) return;

  const selected = reviewCatalog().find(t => t.id === reviewState.selectedId) || null;
  if (tag) tag.textContent = selected ? `TB-${selected.id}` : '';

  if (!selected) {
    root.innerHTML = `
      <div class="review-composer-empty">
        <div class="review-composer-empty-icon">→</div>
        <div class="review-composer-empty-title">Select a turnback</div>
        <p>Browse the library to the left. Click any row to load it here. Fill the placeholder, review rule checks, and push it into the findings basket on the right.</p>
        <ol class="review-steps">
          <li><span>01</span> Filter by Document → Form 1/2/3</li>
          <li><span>02</span> Search blocks, categories, keywords</li>
          <li><span>03</span> Compose with {} placeholder filler</li>
          <li><span>04</span> Export TSV → paste into Excel template</li>
        </ol>
      </div>
    `;
    return;
  }

  const rules = reviewEvaluateRules(selected);
  const phVal = reviewState.placeholder.trim();
  const descSrc = selected.desc || '';
  const descParts = descSrc.includes('{}')
    ? descSrc.split('{}')
    : [descSrc, ''];
  const phRender = phVal
    ? `<span class="rev-ph rev-ph-filled">(${esc(phVal)})</span>`
    : `<span class="rev-ph">{ fill placeholder }</span>`;

  const refs = selected.refs || {};
  const refMeta = reviewRefMeta();
  const refsHtml = Object.keys(refs).length
    ? `<div class="review-section">
         <div class="review-section-label">Where to Look — Reference Docs</div>
         <div class="rev-refs">
           ${Object.entries(refs).map(([name, loc]) => {
             const meta = refMeta[name];
             const tone = (meta && meta.tone) || 'secondary';
             const full = (meta && meta.full) || name;
             return `
               <div class="rev-ref rev-ref-${tone}">
                 <div class="rev-ref-body">
                   <div class="rev-ref-name">${esc(name)}</div>
                   <div class="rev-ref-full">${esc(full)}</div>
                 </div>
                 <span class="rev-ref-loc">→ ${esc(loc)}</span>
               </div>
             `;
           }).join('')}
         </div>
       </div>`
    : '';

  const progChips = (selected.prog || []).map(p => `<span class="rev-prog-tag">${esc(p)}</span>`).join('');

  const phEditor = descSrc.includes('{}') ? `
    <div class="review-field">
      <label class="review-field-label">Placeholder specifics (block #, finding ref, etc.)</label>
      <input type="text" class="modal-input" id="revPlaceholderInput"
             value="${revAttr(reviewState.placeholder)}"
             placeholder='e.g. "Block 7 Rev N/A", "see finding TB-20900", "per drawing zone B4"'
             oninput="revUpdatePlaceholder(this.value)">
    </div>
  ` : '';

  root.innerHTML = `
    <div class="review-composer-body">
      <header class="review-composer-header">
        <div class="review-composer-meta">
          ${renderSubBadge(selected.sub)}
          <span class="review-composer-meta-item">${esc(selected.doc || '')}${selected.blk ? ` · BLK ${esc(selected.blk)}` : ''}</span>
          ${progChips}
        </div>
        <h3 class="review-composer-title">${esc(selected.ttl || '(untitled)')}</h3>
        <div class="review-composer-path">${esc(selected.step || '')}${selected.cat ? ` → ${esc(selected.cat)}` : ''}</div>
      </header>

      ${rules.length ? `
        <div class="review-rules">
          ${rules.map(r => `
            <div class="review-rule review-rule-${r.kind}">
              <div class="review-rule-title">${esc(r.title)}</div>
              <div class="review-rule-body">${esc(r.body)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="review-section">
        <div class="review-section-label">Standardized Turnback Text</div>
        ${reviewState.editingDesc ? `
          <textarea class="modal-input modal-textarea rev-desc-editor" id="revDescEditor"
                    rows="5" placeholder="Turnback text. Use {} to mark where placeholder specifics are injected.">${esc(descSrc)}</textarea>
          <div class="rev-desc-edit-actions">
            <button type="button" class="modal-cancel-btn" onclick="revCancelDescEdit()">Cancel</button>
            <button type="button" class="modal-save-btn" onclick="revSaveDescEdit()">Edit</button>
          </div>
        ` : `
          <div class="review-desc-box review-desc-box-editable" onclick="revStartDescEdit()" title="Click to edit">
            ${esc(descParts[0])}${phRender}${esc(descParts[1] || '')}
          </div>
        `}
        ${reviewState.editingDesc ? '' : phEditor}
      </div>

      ${selected.allow ? `
        <div class="review-section">
          <div class="review-section-label">Allowances / Notes</div>
          <div class="review-allow-box">${esc(selected.allow)}</div>
        </div>
      ` : ''}

      ${refsHtml}

      <div class="review-composer-actions">
        <button class="add-doc-btn review-btn-primary" onclick="revAddFinding()">+ Add to Findings</button>
        <button class="toolbar-btn" onclick="revClearSelection()">× Clear</button>
        <button class="toolbar-btn" onclick="openReviewTbModal(${JSON.stringify(selected.id)})">&#9998; Edit</button>
      </div>
    </div>
  `;
}

function revUpdatePlaceholder(val) {
  reviewState.placeholder = val;
  const box = document.querySelector('.review-desc-box');
  if (!box) return;
  const selected = reviewCatalog().find(t => t.id === reviewState.selectedId);
  if (!selected) return;
  const src = selected.desc || '';
  const parts = src.includes('{}') ? src.split('{}') : [src, ''];
  const ph = val.trim()
    ? `<span class="rev-ph rev-ph-filled">(${esc(val.trim())})</span>`
    : `<span class="rev-ph">{ fill placeholder }</span>`;
  box.innerHTML = `${esc(parts[0])}${ph}${esc(parts[1] || '')}`;
}

function revClearSelection() {
  reviewState.selectedId = null;
  reviewState.placeholder = "";
  reviewState.editingDesc = false;
  renderReviewList();
  renderReviewComposer();
}

function revStartDescEdit() {
  if (!reviewState.selectedId) return;
  reviewState.editingDesc = true;
  renderReviewComposer();
  const ta = document.getElementById('revDescEditor');
  if (ta) {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

function revCancelDescEdit() {
  reviewState.editingDesc = false;
  renderReviewComposer();
}

function revSaveDescEdit() {
  const ta = document.getElementById('revDescEditor');
  if (!ta) return;
  const newDesc = ta.value.trim();
  if (!Array.isArray(appData.reviewTurnbacks)) return;
  const i = appData.reviewTurnbacks.findIndex(t => t.id === reviewState.selectedId);
  if (i < 0) { reviewState.editingDesc = false; renderReviewComposer(); return; }
  appData.reviewTurnbacks[i].desc = newDesc;
  saveData(appData);
  reviewState.editingDesc = false;
  renderReviewComposer();
}

// === FINDINGS BASKET ===
function revAddFinding() {
  const selected = reviewCatalog().find(t => t.id === reviewState.selectedId);
  if (!selected) return;
  const ph = reviewState.placeholder.trim();
  const src = selected.desc || '';
  const filled = src.includes('{}')
    ? src.replace('{}', ph ? `(${ph})` : '')
    : src;
  reviewState.findings.push({
    fid: Date.now() + Math.random(),
    tid: selected.id,
    doc: selected.doc,
    step: selected.step,
    category: selected.cat,
    description: filled.trim(),
    subcategory: selected.sub,
    refs: selected.refs || {}
  });
  reviewState.selectedId = null;
  reviewState.placeholder = "";
  renderReviewList();
  renderReviewComposer();
  renderReviewBasket();
}

function revRemoveFinding(fid) {
  reviewState.findings = reviewState.findings.filter(f => f.fid !== fid);
  renderReviewBasket();
  renderReviewComposer();
}

function revClearAllFindings() {
  if (!reviewState.findings.length) return;
  if (!confirm('Clear all findings from the basket?')) return;
  reviewState.findings = [];
  reviewState.findingSearch = "";
  const searchEl = document.getElementById('revBasketSearch');
  if (searchEl) searchEl.value = '';
  renderReviewBasket();
  renderReviewComposer();
}

function revUpdateFindingSearch(val) {
  reviewState.findingSearch = val;
  renderReviewBasket();
}

// === RENDER: basket ===
function renderReviewBasket() {
  const root = document.getElementById('revBasket');
  const countEl = document.getElementById('revBasketCount');
  const filtersEl = document.getElementById('revBasketFilters');
  if (!root) return;

  const f = reviewState.findings;
  const q = (reviewState.findingSearch || '').trim().toLowerCase();
  const filtered = q ? f.filter(item => {
    const hay = `TB-${item.tid} ${item.description || ''} ${item.step || ''} ${item.category || ''} ${item.subcategory || ''} ${item.doc || ''}`.toLowerCase();
    return hay.includes(q);
  }) : f;

  if (countEl) {
    const total = f.length;
    const shown = filtered.length;
    countEl.textContent = q && total
      ? `${String(shown).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
      : String(total).padStart(2, '0');
    countEl.classList.toggle('review-basket-count-has', total > 0);
  }

  // Filter row is only meaningful in List view — export always dumps every finding.
  if (filtersEl) {
    filtersEl.style.display = (reviewState.panelView === 'export') ? 'none' : '';
  }

  if (reviewState.panelView === 'export') {
    renderReviewExport();
    return;
  }

  if (f.length === 0) {
    root.innerHTML = `<div class="review-empty">Basket empty — added turnbacks appear here, keyed by their turnback code.</div>`;
    return;
  }

  if (filtered.length === 0) {
    root.innerHTML = `<div class="review-empty">No findings match "${esc(q)}". <a href="#" onclick="event.preventDefault(); revUpdateFindingSearch(''); document.getElementById('revBasketSearch').value='';">Clear search</a> to see all ${f.length}.</div>`;
    return;
  }

  root.innerHTML = filtered.map((item) => `
    <div class="review-finding-card">
      <button class="icon-btn-sm rev-finding-remove" onclick="revRemoveFinding(${item.fid})" title="Remove finding">×</button>
      <div class="rev-finding-head">
        <span class="rev-finding-id">TB-${esc(String(item.tid))}</span>
        ${renderSubBadge(item.subcategory)}
      </div>
      <div class="rev-finding-path">${esc(item.doc || '')} / ${esc(item.category || '')}</div>
      <div class="rev-finding-desc">${esc(item.description || '')}</div>
    </div>
  `).join('');
}

function renderReviewExport() {
  const root = document.getElementById('revBasket');
  if (!root) return;
  const headers = ["ID","Entered By","Entered Date","Process Step","Category","Turnback Description","Corrective Action - Supplier","Part Number","Supplier Code","Supplier Name"];
  const today = new Date().toISOString().slice(0, 10);
  const rows = reviewState.findings.map((f) => [
    `${f.tid}`,
    reviewState.meta.enteredBy || '',
    today,
    f.step || '',
    f.subcategory || '',
    f.description || '',
    '',
    reviewState.meta.partNumber || '',
    reviewState.meta.supplierCode || '',
    reviewState.meta.supplierName || ''
  ]);
  const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');

  root.innerHTML = `
    <div class="review-export">
      <div class="review-export-intro">
        <div class="review-section-label">TSV Preview — paste into Excel template</div>
        <p>Columns match the Findings1 template exactly. Open the Turnbacks sheet, click cell A2, paste.</p>
      </div>
      <pre class="review-tsv-box">${reviewState.findings.length ? esc(tsv) : '— no findings to export —'}</pre>
      <div class="review-export-actions">
        <button class="finding-generate-btn" id="revCopyTsvBtn"
                ${reviewState.findings.length ? '' : 'disabled'}>
          Copy TSV to Clipboard
        </button>
        <button class="icon-btn delete-btn" onclick="revClearAllFindings()"
                ${reviewState.findings.length ? '' : 'disabled'} title="Clear basket">×</button>
      </div>
    </div>
  `;
  const btn = document.getElementById('revCopyTsvBtn');
  if (btn) btn.onclick = () => {
    copyToClipboard(tsv, () => {
      btn.textContent = 'Copied to clipboard';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy TSV to Clipboard'; btn.classList.remove('copied'); }, 1500);
    });
  };
}

function revSetPanelView(view) {
  reviewState.panelView = view;
  document.getElementById('revTabList').classList.toggle('active', view === 'list');
  document.getElementById('revTabExport').classList.toggle('active', view === 'export');
  renderReviewBasket();
}

// === METADATA INPUTS ===
function revBindMetaInputs() {
  const map = {
    revMetaFairId: 'fairId',
    revMetaPart: 'partNumber',
    revMetaSupCode: 'supplierCode',
    revMetaSupName: 'supplierName',
    revMetaEnteredBy: 'enteredBy'
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = reviewState.meta[key] || '';
    el.oninput = (e) => {
      reviewState.meta[key] = e.target.value;
      renderReviewBasket();
    };
  });
  const search = document.getElementById('revSearch');
  if (search) {
    search.value = reviewState.query;
    search.oninput = (e) => {
      reviewState.query = e.target.value;
      renderReviewList();
    };
  }
  const addTbBtn = document.getElementById('revAddTbBtn');
  if (addTbBtn) addTbBtn.onclick = () => openReviewTbModal(null);
  const manageRefsBtn = document.getElementById('revManageRefsBtn');
  if (manageRefsBtn) manageRefsBtn.onclick = openReviewRefMetaModal;
}

// === CRUD: Turnback ===

function openReviewTbModal(tid) {
  const isEdit = tid !== null && tid !== undefined;
  const existing = isEdit ? reviewCatalog().find(t => t.id === tid) : null;
  if (isEdit && !existing) { alert('Turnback not found.'); return; }

  const tb = existing || {
    id: suggestReviewTbId(),
    doc: REVIEW_DOCS[0],
    blk: 'ALL',
    ttl: '',
    step: '',
    cat: '',
    sub: 'L3 - Refer to procedure',
    desc: '',
    allow: '',
    prog: [],
    refs: {}
  };

  const docOpts = REVIEW_DOCS
    .map(d => `<option value="${esc(d)}" ${d === tb.doc ? 'selected' : ''}>${esc(d)}</option>`).join('');

  const knownSubs = [
    'L2 - MRD accountability',
    'L2 - Characteristic accountability',
    'L2 - Certification accountability',
    'L3 - Refer to procedure',
    'L3 - Format/legibility',
    'L3 - MPN accountability'
  ];
  // Include the current value even if not in the known list
  const subSet = knownSubs.includes(tb.sub) ? knownSubs : [tb.sub, ...knownSubs].filter(Boolean);
  const subOpts = subSet
    .map(s => `<option value="${esc(s)}" ${s === tb.sub ? 'selected' : ''}>${esc(s)}</option>`).join('');

  const progChecks = REVIEW_PROGRAMS.map(p => `
    <label class="review-check">
      <input type="checkbox" value="${esc(p)}" ${(tb.prog || []).includes(p) ? 'checked' : ''}>
      ${esc(p)}
    </label>
  `).join('');

  const refsRows = Object.entries(tb.refs || {}).map(([name, loc]) => refRowHtml(name, loc)).join('');

  const body = `
    <div class="modal-row">
      <div class="modal-field">
        <label>ID</label>
        <input type="number" class="modal-input" id="revTbId" value="${esc(String(tb.id))}" ${isEdit ? 'readonly' : ''}>
      </div>
      <div class="modal-field">
        <label>Document</label>
        <select class="modal-input" id="revTbDoc">${docOpts}</select>
      </div>
    </div>
    <div class="modal-row">
      <div class="modal-field">
        <label>Block</label>
        <input type="text" class="modal-input" id="revTbBlk" value="${revAttr(tb.blk || '')}" placeholder="ALL, Block 5, Block 14a...">
      </div>
      <div class="modal-field">
        <label>Severity</label>
        <select class="modal-input" id="revTbSub">${subOpts}</select>
      </div>
    </div>
    <div class="modal-field">
      <label>Title</label>
      <input type="text" class="modal-input" id="revTbTtl" value="${revAttr(tb.ttl || '')}" placeholder="e.g. Missing serial #">
    </div>
    <div class="modal-field">
      <label>Process Step</label>
      <input type="text" class="modal-input" id="revTbStep" value="${revAttr(tb.step || '')}" placeholder="e.g. AS9102 Form 2 Validation">
    </div>
    <div class="modal-field">
      <label>Category</label>
      <input type="text" class="modal-input" id="revTbCat" value="${revAttr(tb.cat || '')}" placeholder="e.g. Block 03 Serial Number">
    </div>
    <div class="modal-field">
      <label>Standardized Description <span class="modal-hint-inline">(use {} as the placeholder slot)</span></label>
      <textarea class="modal-input modal-textarea" id="revTbDesc" rows="4" placeholder="Form 2 Block 3: ... {}">${esc(tb.desc || '')}</textarea>
    </div>
    <div class="modal-field">
      <label>Allowances / Notes (optional)</label>
      <textarea class="modal-input modal-textarea" id="revTbAllow" rows="2">${esc(tb.allow || '')}</textarea>
    </div>
    <div class="modal-field">
      <label>Programs</label>
      <div class="review-check-row">${progChecks}</div>
    </div>
    <div class="modal-field">
      <label>References
        <button type="button" class="panel-add-btn" id="revTbAddRefBtn" style="float:right;">+ Add Ref</button>
      </label>
      <div id="revTbRefs" class="review-ref-rows">${refsRows}</div>
    </div>
  `;

  openModal(isEdit ? `Edit Turnback TB-${tb.id}` : 'Add Turnback', body, () => saveReviewTurnback(isEdit ? tb.id : null));

  document.getElementById('revTbAddRefBtn').onclick = () => {
    const host = document.getElementById('revTbRefs');
    host.insertAdjacentHTML('beforeend', refRowHtml('', ''));
  };
  document.getElementById('revTbRefs').addEventListener('click', (e) => {
    const rm = e.target.closest('.rev-ref-row-remove');
    if (rm) rm.closest('.rev-ref-row').remove();
  });
}

function refRowHtml(name, loc) {
  return `
    <div class="rev-ref-row">
      <input type="text" class="modal-input rev-ref-row-name" value="${revAttr(name)}" placeholder="Doc name (e.g. HSM236)">
      <input type="text" class="modal-input rev-ref-row-loc" value="${revAttr(loc)}" placeholder="Location (e.g. Sec 2.3, pg 8)">
      <button type="button" class="icon-btn-sm delete-btn rev-ref-row-remove" title="Remove ref">×</button>
    </div>
  `;
}

function suggestReviewTbId() {
  const ids = reviewCatalog().map(t => Number(t.id)).filter(n => !isNaN(n));
  if (!ids.length) return 10000;
  return Math.max(...ids) + 1;
}

function saveReviewTurnback(editingId) {
  const isEdit = editingId !== null && editingId !== undefined;
  const idRaw = document.getElementById('revTbId').value.trim();
  const id = Number(idRaw);
  if (!idRaw || isNaN(id)) { alert('ID must be a number.'); return; }
  if (!isEdit && reviewCatalog().some(t => t.id === id)) { alert('A turnback with this ID already exists.'); return; }

  const prog = Array.from(document.querySelectorAll('.review-check input[type=checkbox]:checked'))
    .map(cb => cb.value);

  const refs = {};
  document.querySelectorAll('#revTbRefs .rev-ref-row').forEach(row => {
    const name = row.querySelector('.rev-ref-row-name').value.trim();
    const loc = row.querySelector('.rev-ref-row-loc').value.trim();
    if (name) refs[name] = loc;
  });

  const record = {
    id,
    doc: document.getElementById('revTbDoc').value,
    blk: document.getElementById('revTbBlk').value.trim(),
    ttl: document.getElementById('revTbTtl').value.trim(),
    step: document.getElementById('revTbStep').value.trim(),
    cat: document.getElementById('revTbCat').value.trim(),
    sub: document.getElementById('revTbSub').value,
    desc: document.getElementById('revTbDesc').value.trim(),
    allow: document.getElementById('revTbAllow').value.trim(),
    prog,
    refs
  };

  if (!record.ttl) { alert('Title is required.'); return; }

  if (!Array.isArray(appData.reviewTurnbacks)) appData.reviewTurnbacks = [];
  if (isEdit) {
    const i = appData.reviewTurnbacks.findIndex(t => t.id === editingId);
    if (i >= 0) appData.reviewTurnbacks[i] = record;
    if (reviewState.selectedId === editingId) reviewState.selectedId = record.id;
  } else {
    appData.reviewTurnbacks.push(record);
  }
  saveData(appData);
  closeModal();
  renderReviewMode();
}

function deleteReviewTurnback(tid) {
  const tb = reviewCatalog().find(t => t.id === tid);
  if (!tb) return;
  if (!confirm(`Delete turnback TB-${tb.id} "${tb.ttl || ''}"?`)) return;
  appData.reviewTurnbacks = appData.reviewTurnbacks.filter(t => t.id !== tid);
  if (reviewState.selectedId === tid) reviewState.selectedId = null;
  saveData(appData);
  renderReviewMode();
}

// === CRUD: Reference metadata ===

function openReviewRefMetaModal() {
  const meta = reviewRefMeta();
  const rowHtml = (name, full, tone) => `
    <div class="rev-refmeta-row">
      <input type="text" class="modal-input rev-refmeta-name" value="${revAttr(name)}" placeholder="Short name (HSM236)">
      <input type="text" class="modal-input rev-refmeta-full" value="${revAttr(full || '')}" placeholder="Full label">
      <select class="modal-input rev-refmeta-tone">
        ${REVIEW_REF_TONES.map(t => `<option value="${t}" ${t === tone ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <button type="button" class="icon-btn-sm delete-btn rev-refmeta-remove" title="Remove">×</button>
    </div>
  `;
  const rows = Object.entries(meta)
    .map(([name, info]) => rowHtml(name, info && info.full, (info && info.tone) || 'secondary'))
    .join('') || rowHtml('', '', 'secondary');

  const body = `
    <p class="modal-hint">Reference docs shown in the composer's "Where to Look" section. The short name matches what you put in each turnback's refs.</p>
    <div id="revRefMetaRows" class="review-refmeta-rows">${rows}</div>
    <button type="button" class="panel-add-btn" id="revRefMetaAddBtn">+ Add Row</button>
  `;

  openModal('Reference Document Metadata', body, () => {
    const next = {};
    document.querySelectorAll('#revRefMetaRows .rev-refmeta-row').forEach(row => {
      const name = row.querySelector('.rev-refmeta-name').value.trim();
      const full = row.querySelector('.rev-refmeta-full').value.trim();
      const tone = row.querySelector('.rev-refmeta-tone').value;
      if (name) next[name] = { full, tone };
    });
    appData.reviewRefMeta = next;
    saveData(appData);
    closeModal();
    renderReviewComposer();
  });

  document.getElementById('revRefMetaAddBtn').onclick = () => {
    document.getElementById('revRefMetaRows').insertAdjacentHTML('beforeend', rowHtml('', '', 'secondary'));
  };
  document.getElementById('revRefMetaRows').addEventListener('click', (e) => {
    const rm = e.target.closest('.rev-refmeta-remove');
    if (rm) rm.closest('.rev-refmeta-row').remove();
  });
}

// === INIT ===
function renderReviewMode() {
  renderReviewChips();
  renderReviewList();
  renderReviewComposer();
  renderReviewBasket();
  revBindMetaInputs();
}
