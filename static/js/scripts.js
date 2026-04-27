// FAIRWELL UI — rendering, navigation, modals, and CRUD.
// Depends on data.js (SEED_DATA, loadData, saveData, etc.)

let appData = loadData();

// Documents are owned by /api/documents/, not localStorage. Discard any stale
// doc list that may be in localStorage from a previous user on this browser
// (e.g. a logout/login as a different account) so the SPA never renders docs
// the current account doesn't own.

if (typeof USE_DOCUMENTS_API !== 'undefined' && USE_DOCUMENTS_API) {
  appData.documents = [];
}

// ────────────────────────── Navigation ──────────────────────────

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const btn = (typeof event !== 'undefined' && event && event.target)
    ? event.target.closest('.nav-btn') : null;
  if (btn) btn.classList.add('active');
}

function showForm(id) {
  document.querySelectorAll('.form-container').forEach(f => f.classList.remove('active'));
  document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  event.target.classList.add('active');
}

// ────────────────────────── Document Map ──────────────────────────

function renderDocGrid() {
  const grid = document.getElementById('docGrid');
  grid.innerHTML = '';
  appData.documents.forEach((doc, idx) => {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.style.setProperty('--card-color', `var(--${doc.colorClass})`);
    card.innerHTML = `
      <div class="doc-header">
        <span class="doc-badge">${esc(doc.badge)}</span>
        <a href="${esc(doc.url)}" class="doc-title-link">${esc(doc.title)}</a>
        <div class="doc-actions">
          <button class="icon-btn edit-btn" title="Edit document" data-idx="${idx}">&#9998;</button>
          <button class="icon-btn delete-btn" title="Delete document" data-idx="${idx}">&times;</button>
        </div>
      </div>
      <div class="doc-role">${esc(doc.role)}</div>
      <div class="doc-desc">${esc(doc.desc)}</div>
      <div class="doc-links">
        ${doc.links.map(l => `<a href="${esc(l.url)}" class="doc-link">\u2192 ${esc(l.text)}</a>`).join('')}
      </div>
    `;
    card.querySelector('.edit-btn').onclick = (e) => { e.stopPropagation(); openDocModal(idx); };
    card.querySelector('.delete-btn').onclick = (e) => { e.stopPropagation(); deleteDocument(idx); };
    grid.appendChild(card);
  });
}

async function deleteDocument(idx) {
  if (!confirm('Delete this document?')) return;
  const doc = appData.documents[idx];
  if (typeof USE_DOCUMENTS_API !== 'undefined' && USE_DOCUMENTS_API) {
    try {
      await apiDeleteDocument(doc.id);
    } catch (err) {
      alert('Delete failed: ' + err.message);
      return;
    }
    appData.documents.splice(idx, 1);
  } else {
    appData.documents.splice(idx, 1);
    saveData(appData);
  }
  renderDocGrid();
}

async function hydrateCatalogFromApi() {
  try {
    const [colors, types, documents] = await Promise.all([
      apiFetchColors(),
      apiFetchTypes(),
      apiFetchDocuments(),
    ]);
    if (Array.isArray(colors) && colors.length) appData.colors = colors;
    if (Array.isArray(types) && types.length) appData.types = types;
    appData.documents = documents;
    applyCustomColors();
    if (typeof renderLegend === 'function') renderLegend();
    renderDocGrid();
  } catch (err) {
    console.error('Failed to hydrate catalog from API:', err);
  }
}

function openManageTypesModal() {
  const renderBody = () => {
    const colors = getColors(appData);
    const types = getTypes(appData);
    const colorOpts = colors.map(c =>
      `<option value="${esc(c.id)}">${esc(c.label)}</option>`
    ).join('');

    const list = types.length === 0
      ? `<div class="modal-empty-hint">No types yet. Add one below.</div>`
      : types.map(t => {
          const color = (colors.find(c => c.id === t.colorId) || {});
          return `
            <div class="legend-item" data-slug="${esc(t.id)}">
              <div class="legend-dot" style="background:var(--${esc(t.colorId)}, var(--accent-blue))"></div>
              <span class="legend-label">${esc(t.label)}</span>
              <span class="legend-sub">${esc(color.label || t.colorId || '—')}</span>
              <div class="legend-actions">
                <button class="icon-btn-sm del-type-btn" data-slug="${esc(t.id)}" title="Delete type">&times;</button>
              </div>
            </div>`;
        }).join('');

    return `
      <div class="manage-types-list">${list}</div>
      <div class="manage-types-add">
        <input type="text" class="modal-input" id="newTypeLabel" placeholder="New type label (e.g. SUPPLEMENT)">
        <select class="modal-input" id="newTypeColor">${colorOpts}</select>
        <button class="panel-add-btn" id="addTypeBtn">+ Add</button>
      </div>
    `;
  };

  const refresh = () => {
    document.getElementById('modalBody').innerHTML = renderBody();
    wireRows();
  };

  const wireRows = () => {
    document.querySelectorAll('.del-type-btn').forEach(btn => {
      btn.onclick = async () => {
        const slug = btn.dataset.slug;
        if (!confirm(`Delete type "${slug}"?`)) return;
        try {
          await apiDeleteType(slug);
          appData.types = appData.types.filter(t => t.id !== slug);
          refresh();
        } catch (err) {
          alert('Delete failed: ' + err.message);
        }
      };
    });
    const addBtn = document.getElementById('addTypeBtn');
    if (addBtn) {
      addBtn.onclick = async () => {
        const label = document.getElementById('newTypeLabel').value.trim();
        const colorId = document.getElementById('newTypeColor').value;
        if (!label) { alert('Label is required'); return; }
        try {
          const created = await apiCreateType({ label, colorId });
          appData.types.push(created);
          refresh();
        } catch (err) {
          alert('Add failed: ' + err.message);
        }
      };
    }
  };

  openModal('Manage Document Types', renderBody(), () => closeModal());
  wireRows();
}

// ────────────────────────── Hierarchy ──────────────────────────

function renderHierarchy() {
  const container = document.getElementById('hierarchyContainer');
  if (!container) return;
  const levels = appData.hierarchy || [];
  container.innerHTML = '';

  levels.forEach((level, li) => {
    // Connector between levels (skip before first)
    if (li > 0) {
      container.insertAdjacentHTML('beforeend',
        '<div class="hierarchy-connector"><div class="connector-line"></div></div>');
    }

    const isBranch = level.type === 'branch';
    const wrapper = document.createElement('div');
    wrapper.className = isBranch ? 'hierarchy-branch' : 'hierarchy-level';

    level.cards.forEach((card, ci) => {
      const colorVar = `var(--${card.colorId || 'accent-blue'})`;
      const cardEl = document.createElement('div');
      cardEl.className = `hier-card${card.foundation ? ' foundation' : ''}`;
      cardEl.style.setProperty('--hier-color', colorVar);
      const moveBtns = [];
      if (li > 0) moveBtns.push(`<button class="icon-btn-sm" title="Move card up" data-move="up" data-li="${li}" data-ci="${ci}">&uarr;</button>`);
      if (li < levels.length - 1) moveBtns.push(`<button class="icon-btn-sm" title="Move card down" data-move="down" data-li="${li}" data-ci="${ci}">&darr;</button>`);
      if (ci > 0) moveBtns.push(`<button class="icon-btn-sm" title="Move card left" data-move="left" data-li="${li}" data-ci="${ci}">&larr;</button>`);
      if (ci < level.cards.length - 1) moveBtns.push(`<button class="icon-btn-sm" title="Move card right" data-move="right" data-li="${li}" data-ci="${ci}">&rarr;</button>`);
      cardEl.innerHTML = `
        <div class="hier-badge" style="background:color-mix(in srgb, ${colorVar} 15%, transparent);color:${colorVar};">${esc(card.badge)}</div>
        <div class="hier-name">${esc(card.name)}</div>
        <div class="hier-desc">${esc(card.desc)}</div>
        <div class="hier-actions">
          ${moveBtns.join('')}
          <button class="icon-btn-sm" title="Edit card" data-li="${li}" data-ci="${ci}">&#9998;</button>
          <button class="icon-btn-sm hier-del" title="Delete card" data-li="${li}" data-ci="${ci}">&times;</button>
        </div>
      `;
      wrapper.appendChild(cardEl);
    });

    // "+ Add Card" button for all levels
    const addBtn = document.createElement('button');
    addBtn.className = 'hier-add-card-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add card to this level';
    addBtn.onclick = () => openHierCardModal(li, -1);
    wrapper.appendChild(addBtn);

    container.appendChild(wrapper);

    // Level action bar (switch type / delete level)
    const levelBar = document.createElement('div');
    levelBar.className = 'hier-level-bar';
    levelBar.innerHTML = `
      <button class="icon-btn-sm" title="Toggle single/branch" data-action="toggle" data-li="${li}">&#8644;</button>
      <button class="icon-btn-sm hier-del" title="Delete level" data-action="delLevel" data-li="${li}">&times;</button>
    `;
    container.appendChild(levelBar);
  });

  // Wire card move buttons
  container.querySelectorAll('.hier-card [data-move]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); moveHierCard(+btn.dataset.li, +btn.dataset.ci, btn.dataset.move); };
  });
  // Wire card edit buttons (no data-move, not .hier-del)
  container.querySelectorAll('.hier-card .icon-btn-sm:not(.hier-del):not([data-move])').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openHierCardModal(+btn.dataset.li, +btn.dataset.ci); };
  });
  container.querySelectorAll('.hier-card .hier-del').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); deleteHierCard(+btn.dataset.li, +btn.dataset.ci); };
  });


  // Wire level bar buttons
  container.querySelectorAll('.hier-level-bar .icon-btn-sm').forEach(btn => {
    const action = btn.dataset.action;
    btn.onclick = () => {
      if (action === 'toggle') toggleHierLevelType(+btn.dataset.li);
      else if (action === 'delLevel') deleteHierLevel(+btn.dataset.li);
    };
  });
}

function openHierLevelModal() {
  // Add a new level (prompts for single or branch)
  const body = `
    <div class="modal-field">
      <label>Level Type</label>
      <select class="modal-input" id="mdHierType">
        <option value="single">Single (one card)</option>
        <option value="branch">Branch (side-by-side cards)</option>
      </select>
    </div>
    <p class="modal-hint">You'll edit the card(s) after creating the level.</p>
  `;
  openModal('Add Hierarchy Level', body, () => {
    const type = document.getElementById('mdHierType').value;
    const newLevel = {
      type,
      cards: [{ badge: 'NEW', colorId: getColors(appData)[0]?.id || 'hsm236', name: 'New Document', desc: '', foundation: false }]
    };
    if (!appData.hierarchy) appData.hierarchy = [];
    appData.hierarchy.push(newLevel);
    saveData(appData);
    renderHierarchy();
    closeModal();
  });
}

function openHierCardModal(li, ci) {
  const level = appData.hierarchy[li];
  const isEdit = ci >= 0;
  const card = isEdit ? level.cards[ci] : { badge: '', colorId: getColors(appData)[0]?.id || 'hsm236', name: '', desc: '', foundation: false };

  const colorOpts = getColorOptions(appData).map(c =>
    `<option value="${c.id}" ${c.id === card.colorId ? 'selected' : ''}>${c.label}</option>`
  ).join('');

  const body = `
    <div class="modal-field">
      <label>Name</label>
      <input type="text" class="modal-input" id="mdHcName" value="${esc(card.name)}" placeholder="e.g. HSM236">
    </div>
    <div class="modal-row">
      <div class="modal-field">
        <label>Badge</label>
        <input type="text" class="modal-input" id="mdHcBadge" value="${esc(card.badge)}" placeholder="e.g. FAI PROCEDURE">
      </div>
      <div class="modal-field">
        <label>Color</label>
        <select class="modal-input" id="mdHcColor">${colorOpts}</select>
      </div>
    </div>
    <div class="modal-field">
      <label>Description</label>
      <input type="text" class="modal-input" id="mdHcDesc" value="${esc(card.desc)}" placeholder="Short description">
    </div>
    <div class="modal-field">
      <label><input type="checkbox" id="mdHcFoundation" ${card.foundation ? 'checked' : ''}> Foundation card (special styling)</label>
    </div>
  `;

  openModal(isEdit ? 'Edit Hierarchy Card' : 'Add Card to Level', body, () => {
    const updated = {
      badge: document.getElementById('mdHcBadge').value,
      colorId: document.getElementById('mdHcColor').value,
      name: document.getElementById('mdHcName').value,
      desc: document.getElementById('mdHcDesc').value,
      foundation: document.getElementById('mdHcFoundation').checked
    };
    if (!updated.name) { alert('Name is required.'); return; }
    if (isEdit) {
      level.cards[ci] = updated;
    } else {
      level.cards.push(updated);
    }
    saveData(appData);
    renderHierarchy();
    closeModal();
  });
}

function deleteHierCard(li, ci) {
  const level = appData.hierarchy[li];
  if (level.cards.length <= 1) {
    // Last card in level — delete the whole level
    if (!confirm('This is the only card in this level. Delete the entire level?')) return;
    appData.hierarchy.splice(li, 1);
  } else {
    if (!confirm('Delete this card?')) return;
    level.cards.splice(ci, 1);
  }
  saveData(appData);
  renderHierarchy();
}

function deleteHierLevel(li) {
  if (!confirm('Delete this entire hierarchy level and its cards?')) return;
  appData.hierarchy.splice(li, 1);
  saveData(appData);
  renderHierarchy();
}

function moveHierCard(li, ci, dir) {
  const levels = appData.hierarchy;
  const level = levels[li];
  const card = level.cards[ci];

  if (dir === 'left' || dir === 'right') {
    // Reorder within the same level
    const target = dir === 'left' ? ci - 1 : ci + 1;
    if (target < 0 || target >= level.cards.length) return;
    [level.cards[ci], level.cards[target]] = [level.cards[target], level.cards[ci]];
  } else {
    // Move card to an adjacent level (up or down)
    const targetLi = dir === 'up' ? li - 1 : li + 1;
    if (targetLi < 0 || targetLi >= levels.length) return;
    // Remove card from current level
    level.cards.splice(ci, 1);
    // Add card to target level
    levels[targetLi].cards.push(card);
    // If target level now has 2+ cards, make it a branch
    if (levels[targetLi].cards.length > 1) levels[targetLi].type = 'branch';
    // If source level is now empty, remove it
    if (level.cards.length === 0) {
      levels.splice(li, 1);
    }
  }
  saveData(appData);
  renderHierarchy();
}

function toggleHierLevelType(li) {
  const level = appData.hierarchy[li];
  level.type = level.type === 'branch' ? 'single' : 'branch';
  saveData(appData);
  renderHierarchy();
}

// ────────────────────────── Decision Flow ──────────────────────────

function renderDecisionFlow() {
  const container = document.getElementById('decisionFlowContainer');
  if (!container) return;
  const steps = appData.decisionFlow || [];
  container.innerHTML = '';

  steps.forEach((step, si) => {
    // Connector between steps
    if (si > 0) {
      container.insertAdjacentHTML('beforeend',
        '<div class="flow-connector-v"><div class="vline"></div></div>');
    }

    const stepEl = document.createElement('div');
    stepEl.className = 'flow-step';
    stepEl.innerHTML = `
      <div class="flow-step-header">
        <div class="step-num">${esc(step.title)}</div>
        <div class="flow-step-actions">
          ${si > 0 ? `<button class="icon-btn-sm" title="Move up" data-action="up" data-si="${si}">&uarr;</button>` : ''}
          ${si < steps.length - 1 ? `<button class="icon-btn-sm" title="Move down" data-action="down" data-si="${si}">&darr;</button>` : ''}
          <button class="icon-btn-sm" title="Edit step" data-action="edit" data-si="${si}">&#9998;</button>
          <button class="icon-btn-sm hier-del" title="Delete step" data-action="del" data-si="${si}">&times;</button>
        </div>
      </div>
      <div class="step-q">${esc(step.question)}</div>
      <div class="flow-answers">
        ${step.answers.map((a, ai) => `
          <div class="flow-answer ${a.type}">
            <div class="ans-label">${esc(a.label)}</div>
            <div class="ans-action">${a.action}</div>
            <div class="flow-answer-actions">
              <button class="icon-btn-sm" title="Edit answer" data-si="${si}" data-ai="${ai}" data-action="editAns">&#9998;</button>
              <button class="icon-btn-sm hier-del" title="Delete answer" data-si="${si}" data-ai="${ai}" data-action="delAns">&times;</button>
            </div>
          </div>
        `).join('')}
      </div>
      <button class="flow-add-ans-btn" data-si="${si}">+ Add Answer</button>
    `;
    container.appendChild(stepEl);
  });

  // Wire step-level action buttons
  container.querySelectorAll('.flow-step-actions .icon-btn-sm').forEach(btn => {
    const si = +btn.dataset.si;
    const action = btn.dataset.action;
    btn.onclick = (e) => {
      e.stopPropagation();
      if (action === 'up') moveStep(si, -1);
      else if (action === 'down') moveStep(si, 1);
      else if (action === 'edit') openStepModal(si);
      else if (action === 'del') deleteStep(si);
    };
  });

  // Wire answer-level action buttons
  container.querySelectorAll('.flow-answer-actions .icon-btn-sm').forEach(btn => {
    const si = +btn.dataset.si, ai = +btn.dataset.ai;
    const action = btn.dataset.action;
    btn.onclick = (e) => {
      e.stopPropagation();
      if (action === 'editAns') openAnswerModal(si, ai);
      else if (action === 'delAns') deleteAnswer(si, ai);
    };
  });

  // Wire "add answer" buttons
  container.querySelectorAll('.flow-add-ans-btn').forEach(btn => {
    btn.onclick = () => openAnswerModal(+btn.dataset.si, -1);
  });


}

function openStepModal(si) {
  const isEdit = si >= 0;
  const step = isEdit ? appData.decisionFlow[si] : { title: '', question: '', answers: [] };

  const body = `
    <div class="modal-field">
      <label>Step Title</label>
      <input type="text" class="modal-input" id="mdStepTitle" value="${esc(step.title)}" placeholder="e.g. Step 1 — Form 2 Spec Review">
    </div>
    <div class="modal-field">
      <label>Question</label>
      <textarea class="modal-input modal-textarea" id="mdStepQ" rows="3">${esc(step.question)}</textarea>
    </div>
  `;

  openModal(isEdit ? 'Edit Step' : 'Add Step', body, () => {
    const title = document.getElementById('mdStepTitle').value.trim();
    const question = document.getElementById('mdStepQ').value.trim();
    if (!title) { alert('Title is required.'); return; }
    if (isEdit) {
      step.title = title;
      step.question = question;
    } else {
      if (!appData.decisionFlow) appData.decisionFlow = [];
      appData.decisionFlow.push({ title, question, answers: [] });
    }
    saveData(appData);
    renderDecisionFlow();
    closeModal();
  });
}

function deleteStep(si) {
  if (!confirm('Delete this step and all its answers?')) return;
  appData.decisionFlow.splice(si, 1);
  saveData(appData);
  renderDecisionFlow();
}

function moveStep(si, dir) {
  const arr = appData.decisionFlow;
  const target = si + dir;
  if (target < 0 || target >= arr.length) return;
  [arr[si], arr[target]] = [arr[target], arr[si]];
  saveData(appData);
  renderDecisionFlow();
}

function openAnswerModal(si, ai) {
  const step = appData.decisionFlow[si];
  const isEdit = ai >= 0;
  const ans = isEdit ? step.answers[ai] : { type: 'yes', label: '', action: '' };

  const typeOpts = [
    { val: 'yes', label: 'Yes (green)' },
    { val: 'no', label: 'No (red)' },
    { val: 'ref', label: 'Reference (amber)' },
    { val: 'always', label: 'Always (blue)' }
  ].map(t => `<option value="${t.val}" ${t.val === ans.type ? 'selected' : ''}>${t.label}</option>`).join('');

  const body = `
    <div class="modal-field">
      <label>Answer Type</label>
      <select class="modal-input" id="mdAnsType">${typeOpts}</select>
    </div>
    <div class="modal-field">
      <label>Label</label>
      <input type="text" class="modal-input" id="mdAnsLabel" value="${esc(ans.label)}" placeholder="e.g. ✓ Yes — Special Process">
    </div>
    <div class="modal-field">
      <label>Action / Instructions (HTML allowed)</label>
      <textarea class="modal-input modal-textarea" id="mdAnsAction" rows="4">${esc(ans.action)}</textarea>
    </div>
  `;

  openModal(isEdit ? 'Edit Answer' : 'Add Answer', body, () => {
    const updated = {
      type: document.getElementById('mdAnsType').value,
      label: document.getElementById('mdAnsLabel').value.trim(),
      action: document.getElementById('mdAnsAction').value.trim()
    };
    if (!updated.label) { alert('Label is required.'); return; }
    if (isEdit) {
      step.answers[ai] = updated;
    } else {
      step.answers.push(updated);
    }
    saveData(appData);
    renderDecisionFlow();
    closeModal();
  });
}

function deleteAnswer(si, ai) {
  if (!confirm('Delete this answer?')) return;
  appData.decisionFlow[si].answers.splice(ai, 1);
  saveData(appData);
  renderDecisionFlow();
}

// ────────────────────────── Form Grids ──────────────────────────

function renderAllForms() {
  renderForm('f1grid', 'form1Fields', 'Form 1 \u2014 Part Number Accountability');
  renderForm('f2grid', 'form2Fields', 'Form 2 \u2014 Materials, Special Processes & Functional Testing');
  renderForm('f3grid', 'form3Fields', 'Form 3 \u2014 Characteristic Accountability');
}

function renderForm(containerId, formKey, formLabel) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = '';
  const fields = appData[formKey];
  fields.forEach((f, idx) => {
    const cell = document.createElement('div');
    cell.className = `form-cell ${f.span || ''}`;
    cell.innerHTML = `
      <div class="cell-block">${esc(f.block)}</div>
      <div class="cell-name">${esc(f.name)}</div>
      <div class="ref-dots">${(f.refs || []).map(r => `<div class="ref-dot" style="background:var(--${r})"></div>`).join('')}</div>
    `;
    cell.onclick = () => openFieldPanel(formKey, idx, formLabel);
    grid.appendChild(cell);
  });
}

// ────────────────────────── Side Panel (Form Fields) ──────────────────────────

let currentPanelCtx = null; // { formKey, fieldIdx, formLabel }

function openFieldPanel(formKey, fieldIdx, formLabel) {
  currentPanelCtx = { formKey, fieldIdx, formLabel };
  const f = appData[formKey][fieldIdx];
  const panel = document.getElementById('infoPanel');
  const overlay = document.getElementById('overlay');

  let html = `<div class="panel-block-name">${esc(formLabel)} \u00b7 ${esc(f.block)}</div>
    <div class="panel-title">${esc(f.name)}</div>`;

  html += `<div class="panel-section">
    <div class="panel-section-header">
      <div class="panel-section-title">What to Check</div>
      <button class="panel-add-btn" id="editDescBtn">${f.desc ? 'Edit' : '+ Add'}</button>
    </div>
    ${f.desc
      ? `<div class="panel-text">${esc(f.desc)}</div>`
      : `<div class="panel-empty">No description</div>`}
  </div>`;

  // Source Documents
  html += `<div class="panel-section">
    <div class="panel-section-header">
      <div class="panel-section-title">Source Documents</div>
      <button class="panel-add-btn" id="addRefBtn">+ Add</button>
    </div>`;
  if (f.refsDetail && f.refsDetail.length) {
    f.refsDetail.forEach((r, ri) => {
      html += `<div class="panel-ref">
        <span class="ref-badge" style="background:${r.color}20;color:${r.color}">${esc(r.doc)}</span>
        <span class="panel-ref-text">${esc(r.section)}</span>
        <div class="panel-item-actions">
          <button class="icon-btn-sm edit-ref" data-ri="${ri}" title="Edit">&#9998;</button>
          <button class="icon-btn-sm del-ref" data-ri="${ri}" title="Delete">&times;</button>
        </div>
      </div>`;
    });
  } else {
    html += `<div class="panel-empty">No source documents</div>`;
  }
  html += `</div>`;

  // Turnbacks
  html += `<div class="panel-section">
    <div class="panel-section-header">
      <div class="panel-section-title">Potential Turnbacks</div>
      <button class="panel-add-btn" id="addTbBtn">+ Add</button>
    </div>`;
  if (f.turnbacks && f.turnbacks.length) {
    f.turnbacks.forEach((t, ti) => {
      html += `<div class="panel-turnback">
        <input type="radio" name="tb-select" class="tb-check-input" data-ti="${ti}" title="Select for finding">
        <div class="tb-body">
          <div class="tb-head">
            <span class="tb-code">${esc(t.code)}</span>
            ${t.level ? `<span class="tb-level">${esc(t.level)}</span>` : ''}
          </div>
          <div class="tb-desc">${esc(t.desc)}</div>
        </div>
        <div class="panel-item-actions">
          <button class="icon-btn-sm edit-tb" data-ti="${ti}" title="Edit">&#9998;</button>
          <button class="icon-btn-sm del-tb" data-ti="${ti}" title="Delete">&times;</button>
        </div>
      </div>`;
    });
  } else {
    html += `<div class="panel-empty">No turnbacks</div>`;
  }
  html += `</div>`;

  // Generate Finding
  html += `<div class="panel-section">
    <div class="panel-section-title">Generate Finding</div>
    <div class="finding-controls">
      <label class="finding-label">Status</label>
      <input type="text" class="modal-input" id="findingStatus" value="New/Proposed" list="findingStatusList">
      <datalist id="findingStatusList">
        <option value="New/Proposed"></option>
        <option value="Current"></option>
        <option value="Resolved"></option>
      </datalist>
    </div>
    <button class="finding-generate-btn" id="generateFindingBtn">Generate Finding &amp; Copy to Clipboard</button>
    <p class="modal-hint">Select a turnback above, then click to copy a tab-separated row ready to paste into Excel.</p>
  </div>`;

  document.getElementById('panelContent').innerHTML = html;
  panel.classList.add('open');
  overlay.classList.add('open');

  // Wire up panel buttons
  document.getElementById('editDescBtn').onclick = () => openDescModal();
  document.getElementById('addRefBtn').onclick = () => openRefModal(-1);
  document.getElementById('addTbBtn').onclick = () => openTbModal(-1);
  document.getElementById('generateFindingBtn').onclick = () => generateFindings();
  document.querySelectorAll('.edit-ref').forEach(btn => {
    btn.onclick = () => openRefModal(parseInt(btn.dataset.ri));
  });
  document.querySelectorAll('.del-ref').forEach(btn => {
    btn.onclick = () => deleteRef(parseInt(btn.dataset.ri));
  });
  document.querySelectorAll('.edit-tb').forEach(btn => {
    btn.onclick = () => openTbModal(parseInt(btn.dataset.ti));
  });
  document.querySelectorAll('.del-tb').forEach(btn => {
    btn.onclick = () => deleteTb(parseInt(btn.dataset.ti));
  });
}

function closePanel() {
  document.getElementById('infoPanel').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  currentPanelCtx = null;
}

function refreshPanel() {
  if (!currentPanelCtx) return;
  openFieldPanel(currentPanelCtx.formKey, currentPanelCtx.fieldIdx, currentPanelCtx.formLabel);
}

// ────────────────────────── Modal System ──────────────────────────

function openModal(title, bodyHtml, onSave) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalSaveBtn').onclick = () => {
    onSave();
  };
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// ── Document Add / Edit ──

function openDocModal(idx) {
  const isEdit = idx >= 0;
  const firstType = getTypes(appData)[0] || { id: '', colorId: 'hsm236', label: '' };
  const doc = isEdit
    ? appData.documents[idx]
    : { id: '', typeId: firstType.id, badge: firstType.label, colorClass: firstType.colorId, title: '', url: '#', role: '', desc: '', links: [] };

  const currentTypeId = doc.typeId || inferDocTypeId(doc, appData);
  const typeOpts = getTypeOptions(appData).map(t =>
    `<option value="${t.id}" ${t.id === currentTypeId ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  const linksHtml = doc.links.map((l, i) =>
    `<div class="modal-link-row" data-li="${i}">
      <input type="text" class="modal-input link-text" value="${esc(l.text)}" placeholder="Link text">
      <input type="text" class="modal-input link-url" value="${esc(l.url)}" placeholder="URL or file path">
      <button class="icon-btn-sm browse-link-btn" title="Browse for file">\u{1F4C1}</button>
      <button class="icon-btn-sm remove-link-btn" data-li="${i}">&times;</button>
    </div>`
  ).join('');

  const body = `
    <div class="modal-field">
      <label>Title</label>
      <input type="text" class="modal-input" id="mdDocTitle" value="${esc(doc.title)}" placeholder="e.g. HSM236 Rev E">
    </div>
    <div class="modal-field">
      <label>Badge (optional override)</label>
      <input type="text" class="modal-input" id="mdDocBadge" value="${esc(doc.badge)}" placeholder="Leave blank to use Type label">
    </div>
    <div class="modal-row">
      <div class="modal-field">
        <label>Type</label>
        <select class="modal-input" id="mdDocType">${typeOpts}</select>
      </div>
      <div class="modal-field">
        <label>URL</label>
        <div class="modal-link-row" id="mdDocUrlRow">
          <input type="text" class="modal-input link-url" id="mdDocUrl" value="${esc(doc.url)}" placeholder="Drop a file here, paste URL, or /absolute/path">
          <button type="button" class="icon-btn-sm browse-link-btn" title="Browse for file">\u{1F4C1}</button>
          <button type="button" class="icon-btn-sm manual-link-btn" title="Type absolute path manually">\u{270E}</button>
        </div>
        <div class="link-hint">Drag a file from your file manager onto this field, click \u{1F4C1} to browse, or \u{270E} to type a path.</div>
      </div>
    </div>
    <div class="modal-field">
      <label>Role / Subtitle</label>
      <input type="text" class="modal-input" id="mdDocRole" value="${esc(doc.role)}">
    </div>
    <div class="modal-field">
      <label>Description</label>
      <textarea class="modal-input modal-textarea" id="mdDocDesc" rows="4">${esc(doc.desc)}</textarea>
    </div>
    <div class="modal-field">
      <label>Cross-Reference Links</label>
      <div id="mdDocLinks">${linksHtml}</div>
      <button class="panel-add-btn" id="mdAddLinkBtn" style="margin-top:8px">+ Add Link</button>
    </div>
  `;

  openModal(isEdit ? 'Edit Document' : 'Add Document', body, async () => {
    const selectedTypeId = document.getElementById('mdDocType').value;
    const selectedType = getTypes(appData).find(t => t.id === selectedTypeId) || firstType;
    const manualBadge = document.getElementById('mdDocBadge').value.trim();
    const updated = {
      id: doc.id || document.getElementById('mdDocTitle').value.toLowerCase().replace(/[^a-z0-9]/g, ''),
      typeId: selectedType.id,
      badge: manualBadge || selectedType.label,
      colorClass: selectedType.colorId,
      title: document.getElementById('mdDocTitle').value,
      url: normalizeLocalPath(document.getElementById('mdDocUrl').value) || '#',
      role: document.getElementById('mdDocRole').value,
      desc: document.getElementById('mdDocDesc').value,
      links: collectLinks()
    };
    if (typeof USE_DOCUMENTS_API !== 'undefined' && USE_DOCUMENTS_API) {
      try {
        const saved = isEdit
          ? await apiUpdateDocument(doc.id, updated)
          : await apiCreateDocument(updated);
        if (isEdit) appData.documents[idx] = saved;
        else appData.documents.push(saved);
      } catch (err) {
        alert('Save failed: ' + err.message);
        return;
      }
    } else {
      if (isEdit) appData.documents[idx] = updated;
      else appData.documents.push(updated);
      saveData(appData);
    }
    renderDocGrid();
    closeModal();
  });

  // Wire add-link button
  document.getElementById('mdAddLinkBtn').onclick = () => {
    const container = document.getElementById('mdDocLinks');
    const i = container.children.length;
    const row = document.createElement('div');
    row.className = 'modal-link-row';
    row.dataset.li = i;
    row.innerHTML = `
      <input type="text" class="modal-input link-text" value="" placeholder="Link text">
      <input type="text" class="modal-input link-url" value="#" placeholder="Drop a file, paste URL, or /absolute/path">
      <button type="button" class="icon-btn-sm browse-link-btn" title="Browse for file">\u{1F4C1}</button>
      <button type="button" class="icon-btn-sm manual-link-btn" title="Type absolute path manually">\u{270E}</button>
      <button type="button" class="icon-btn-sm remove-link-btn">&times;</button>
    `;
    container.appendChild(row);
    wireLinkRow(row);
  };

  // Wire existing rows
  document.querySelectorAll('#mdDocLinks .modal-link-row').forEach(wireLinkRow);

  // Wire the main doc URL: browse + manual buttons + drop zone on the whole row.
  const mainUrlInput = document.getElementById('mdDocUrl');
  document.querySelector('#mdDocUrlRow .browse-link-btn').onclick = () =>
    pickFileIntoInput(mainUrlInput, null);
  const mainManualBtn = document.querySelector('#mdDocUrlRow .manual-link-btn');
  if (mainManualBtn) mainManualBtn.onclick = () => promptForManualPath(mainUrlInput);
  wireDropToInput(mainUrlInput, document.getElementById('mdDocUrlRow'));
}

function wireLinkRow(row) {
  row.querySelector('.remove-link-btn').onclick = () => row.remove();
  const urlInput = row.querySelector('.link-url');
  const textInput = row.querySelector('.link-text');
  row.querySelector('.browse-link-btn').onclick = () => pickFileIntoInput(urlInput, textInput);
  const manualBtn = row.querySelector('.manual-link-btn');
  if (manualBtn) manualBtn.onclick = () => promptForManualPath(urlInput);
  wireDropToInput(urlInput, row);
}

// Normalize a user-entered path or URL into something a browser can actually
// follow. Bare absolute paths become file:// URLs so that links to local
// documents resolve correctly instead of being treated as project-relative.
// Path bodies are percent-encoded so spaces and non-ASCII don't break the URL.
function safeDecodeURI(str) {
  try {
    return decodeURI(str);
  } catch {
    // Fix invalid % sequences like %A → %25A
    return str.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
  }
}

function normalizeLocalPath(input) {
  if (!input) return '';
  let t = String(input).trim();
  if (!t || t === '#') return t;


  // Handle file:// URLs explicitly
  if (/^file:\/\//i.test(t)) {
    let pathPart = t.replace(/^file:\/\/\/?/i, '/');

    pathPart = safeDecodeURI(pathPart);

    return 'file://' + encodeFilePath(pathPart);
  }

  // Other URLs (http, https, etc.) — also catches Windows drive letters (C:).
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;

  // POSIX local path
  return 'file://' + encodeFilePath(safeDecodeURI(t));
}

// Percent-encode a filesystem path for use in a URL. encodeURI preserves the
// structural characters browsers leave alone (`/`, `:`, `&`, `=`, `@`, etc.)
// and encodes spaces, non-ASCII, control chars, and `%`. We post-encode `#`
// and `?` so filenames containing them don't get misread as fragments/queries.
function encodeFilePath(p) {
  return encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// Picker → input helper. On Electron/webview, File.path is the real absolute
// path and we use it directly. In a regular browser, the file picker does not
// expose absolute paths, so we chain straight into the manual-entry prompt
// (pre-seeded with the basename the user just picked).
async function pickFileIntoInput(urlInput, textInput) {
  await pickFile((file) => {
    if (textInput && !textInput.value.trim()) textInput.value = file.name;
    if (file.path) {
      urlInput.value = normalizeLocalPath(file.path);
      return;
    }
    promptForManualPath(urlInput, {
      reason: `Browsers hide absolute paths from the file picker. Picked: "${file.name}".`,
      seedFilename: file.name
    });
  });
}

// Open a text prompt so the user can paste or type an absolute path or URL.
// Pre-seeds with the current input value (decoded back to a human-readable
// path if it looks like a file:// URL). Called from the "Type manually"
// button AND as a fallback when drop/browse can't deliver an absolute path.
function promptForManualPath(urlInput, opts) {
  opts = opts || {};
  const current = (urlInput.value || '').trim();
  let seed = '';
  if (current && current !== '#') {
    if (/^file:\/\//i.test(current)) {
      try {
        seed = decodeURI(current.replace(/^file:\/\/\/?/i, '/'));
      } catch (_) { seed = current; }
    } else {
      seed = current;
    }
  } else if (opts.seedFilename) {
    seed = `/path/to/${opts.seedFilename}`;
  }
  const preamble = opts.reason ? `${opts.reason}\n\n` : '';
  const entered = prompt(
    `${preamble}Paste or type an absolute path or URL:\n\n` +
    `  Linux / macOS:  /home/you/docs/file.pdf\n` +
    `  Windows:        C:\\Users\\you\\Documents\\file.pdf\n` +
    `  Web URL:        https://example.com/file.pdf`,
    seed
  );
  if (entered == null) return;
  const trimmed = entered.trim();
  if (!trimmed) return;
  urlInput.value = normalizeLocalPath(trimmed);
  fillSiblingTextFromUrl(urlInput, urlInput.value);
}

// Make a URL input (and optionally a wider drop zone wrapping it) accept file
// drops. File-manager drops deliver a pre-encoded file:// URL via
// `text/uri-list` — that is the path-of-least-friction for users on any OS.
function wireDropToInput(inputEl, zoneEl) {
  if (!inputEl) return;
  const zone = zoneEl || inputEl;
  if (zone.dataset.dropWired) return;
  zone.dataset.dropWired = '1';

  const setHover = (on) => {
    zone.classList.toggle('drop-hover', on);
    inputEl.classList.toggle('drop-hover', on);
  };

  const accept = (e) => {
    if (!e.dataTransfer) return false;
    const types = Array.from(e.dataTransfer.types || []);
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
  };

  // dragenter AND dragover must both preventDefault for the drop to fire in
  // every browser — Chromium is lenient, Firefox/Safari are stricter.
  zone.addEventListener('dragenter', (e) => {
    if (!accept(e)) return;
    e.preventDefault();
    setHover(true);
  });
  zone.addEventListener('dragover', (e) => {
    if (!accept(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    setHover(true);
  });
  zone.addEventListener('dragleave', (e) => {
    if (zone.contains(e.relatedTarget)) return;
    setHover(false);
  });
  zone.addEventListener('drop', (e) => {
    if (!accept(e)) return;
    e.preventDefault();
    setHover(false);
    const dt = e.dataTransfer;

    // 1. Preferred: file-manager drop — pre-encoded file:// URL, exactly what we want.
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const first = uriList.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
      if (first) {
        inputEl.value = first;
        fillSiblingTextFromUrl(inputEl, first);
        return;
      }
    }

    // 2. Plain text drop (e.g. from a terminal or another app).
    const text = dt.getData('text/plain');
    if (text) {
      const first = text.split('\n').map(l => l.trim()).find(l => l);
      if (first) {
        inputEl.value = normalizeLocalPath(first);
        fillSiblingTextFromUrl(inputEl, inputEl.value);
        return;
      }
    }

    // 3. DataTransfer.files — useful in Electron (has file.path) or as a last-
    //    resort filename hint. If no absolute path is available, fall straight
    //    through to the manual-entry prompt so the user is never stuck.
    if (dt.files && dt.files.length > 0) {
      const file = dt.files[0];
      if (file.path) {
        inputEl.value = normalizeLocalPath(file.path);
        const row = inputEl.closest('.modal-link-row');
        const textInput = row && row.querySelector('.link-text');
        if (textInput && !textInput.value.trim()) textInput.value = file.name;
        return;
      }
      promptForManualPath(inputEl, {
        reason: `Dropped "${file.name}" but this drop source didn't include the absolute path.`,
        seedFilename: file.name
      });
      return;
    }

    // 4. Nothing usable — open the manual prompt anyway so the gesture isn't wasted.
    promptForManualPath(inputEl, {
      reason: `The drop didn't include a path — you can paste or type one below.`
    });
  });
}

// Global guard: prevent the browser from navigating to a file when the user
// drops it ANYWHERE except a real drop zone. Without this, a missed drop on
// the modal chrome (rather than exactly on the URL row) causes the page to
// navigate away from Fairwell, which looks exactly like "drag-drop doesn't
// work". Zone handlers fire first (bubble phase) and preventDefault early;
// this catches the rest.
function installFileDropGuard() {
  if (window.__fwFileDropGuard) return;
  window.__fwFileDropGuard = true;
  const hasFiles = (e) => e.dataTransfer
    && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop',     (e) => { if (hasFiles(e)) e.preventDefault(); });
}

// If the drop target is inside a link row and the label field is empty, seed
// the label with a readable filename decoded from the URL's last path segment.
function fillSiblingTextFromUrl(inputEl, url) {
  const row = inputEl.closest('.modal-link-row');
  if (!row) return;
  const textInput = row.querySelector('.link-text');
  if (!textInput || textInput.value.trim()) return;
  try {
    const basename = decodeURIComponent((new URL(url, 'file:///').pathname.split('/').pop() || '').trim());
    if (basename) textInput.value = basename;
  } catch (_) { /* invalid URL — leave label alone */ }
}

async function pickFile(onFile) {
  // file.path exists in Electron/webview; browsers only expose name
  try {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker();
      const file = await handle.getFile();
      if (file) onFile(file);
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    // fall through to legacy input
  }
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.style.display = 'none';
  fileInput.onchange = () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) onFile(file);
    fileInput.remove();
  };
  document.body.appendChild(fileInput);
  fileInput.click();
}

function collectLinks() {
  const rows = document.querySelectorAll('#mdDocLinks .modal-link-row');
  const links = [];
  rows.forEach(row => {
    const text = row.querySelector('.link-text').value.trim();
    const rawUrl = row.querySelector('.link-url').value.trim();
    const url = normalizeLocalPath(rawUrl) || '#';
    if (text) links.push({ text, url });
  });
  return links;
}

// ── Field Description (What to Check) Edit ──

function openDescModal() {
  const ctx = currentPanelCtx;
  if (!ctx) return;
  const field = appData[ctx.formKey][ctx.fieldIdx];

  const body = `
    <div class="modal-field">
      <label>What to Check</label>
      <textarea class="modal-input modal-textarea" id="mdFieldDesc" rows="6" placeholder="Describe what an inspector should verify for this field.">${esc(field.desc || '')}</textarea>
      <p class="modal-hint">Leave blank to remove the description.</p>
    </div>
  `;

  openModal('Edit "What to Check"', body, () => {
    field.desc = document.getElementById('mdFieldDesc').value.trim();
    saveData(appData);
    renderAllForms();
    refreshPanel();
    closeModal();
  });
}

// ── Generate Finding (TSV row for Excel paste) ──

function generateFindings() {
  const ctx = currentPanelCtx;
  if (!ctx) return;
  const field = appData[ctx.formKey][ctx.fieldIdx];
  const checks = document.querySelectorAll('.tb-check-input:checked');
  if (!checks.length) { alert('Select a turnback first.'); return; }
  const status = (document.getElementById('findingStatus').value || 'New/Proposed').trim();
  const rows = [];
  checks.forEach(cb => {
    const ti = parseInt(cb.dataset.ti, 10);
    const tb = field.turnbacks[ti];
    if (!tb) return;
    const code = (tb.code || '').trim();
    const level = (tb.level || '').trim();
    const desc = (tb.desc || '').trim();
    // Tab-separated columns: Code \t Status \t Level \t Description {}
    rows.push([code, status, level, `${desc} {}`].join('\t'));
  });
  const tsv = rows.join('\n');
  const btn = document.getElementById('generateFindingBtn');
  const original = btn.textContent;
  copyToClipboard(tsv, () => {
    btn.textContent = 'Copied to clipboard';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1500);
  });
}

function copyToClipboard(text, onDone) {
  const done = () => { if (onDone) onDone(); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(done);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
  done();
}

// ── Source Document Ref Add / Edit ──

function openRefModal(ri) {
  const ctx = currentPanelCtx;
  const field = appData[ctx.formKey][ctx.fieldIdx];
  const isEdit = ri >= 0;
  const ref = isEdit ? field.refsDetail[ri] : { doc: '', section: '', color: 'var(--hsm236)' };

  const colorOpts = getColorOptions(appData).map(c =>
    `<option value="${c.css}" ${c.css === ref.color ? 'selected' : ''}>${c.label}</option>`
  ).join('');

  const body = `
    <div class="modal-field">
      <label>Document Name</label>
      <input type="text" class="modal-input" id="mdRefDoc" value="${esc(ref.doc)}" placeholder="e.g. HSM236">
    </div>
    <div class="modal-field">
      <label>Section / Reference</label>
      <input type="text" class="modal-input" id="mdRefSection" value="${esc(ref.section)}" placeholder="e.g. Appendix A, pg 22">
    </div>
    <div class="modal-field">
      <label>Type / Color</label>
      <select class="modal-input" id="mdRefColor">${colorOpts}</select>
    </div>
  `;

  openModal(isEdit ? 'Edit Source Document' : 'Add Source Document', body, () => {
    const updated = {
      doc: document.getElementById('mdRefDoc').value,
      section: document.getElementById('mdRefSection').value,
      color: document.getElementById('mdRefColor').value
    };
    if (!updated.doc) { alert('Document name is required.'); return; }
    if (!field.refsDetail) field.refsDetail = [];
    if (isEdit) {
      field.refsDetail[ri] = updated;
    } else {
      field.refsDetail.push(updated);
    }
    // Sync the short refs array
    syncShortRefs(field);
    saveData(appData);
    renderAllForms();
    refreshPanel();
    closeModal();
  });
}

function deleteRef(ri) {
  const ctx = currentPanelCtx;
  const field = appData[ctx.formKey][ctx.fieldIdx];
  field.refsDetail.splice(ri, 1);
  syncShortRefs(field);
  saveData(appData);
  renderAllForms();
  refreshPanel();
}

function syncShortRefs(field) {
  // Rebuild the short refs array from refsDetail for the colored dots display
  const colorToId = {};
  getColorOptions(appData).forEach(c => { colorToId[c.css] = c.id; });
  field.refs = (field.refsDetail || []).map(r => colorToId[r.color] || 'hsm236');
  // Deduplicate
  field.refs = [...new Set(field.refs)];
}

// ── Turnback Add / Edit ──

function openTbModal(ti) {
  const ctx = currentPanelCtx;
  const field = appData[ctx.formKey][ctx.fieldIdx];
  const isEdit = ti >= 0;
  const tb = isEdit ? field.turnbacks[ti] : { code: '', level: '', desc: '' };

  const body = `
    <div class="modal-field">
      <label>Turnback Code</label>
      <input type="text" class="modal-input" id="mdTbCode" value="${esc(tb.code)}" placeholder="e.g. 11500">
    </div>
    <div class="modal-field">
      <label>Level</label>
      <input type="text" class="modal-input" id="mdTbLevel" value="${esc(tb.level || '')}" placeholder="e.g. L2 - MRD accountability">
    </div>
    <div class="modal-field">
      <label>Standardized Description</label>
      <textarea class="modal-input modal-textarea" id="mdTbDesc" rows="4" placeholder="e.g. Form 1 Block 15: Shall list out all detail/next level sub-assembly/COTS parts...">${esc(tb.desc)}</textarea>
    </div>
  `;

  openModal(isEdit ? 'Edit Turnback' : 'Add Turnback', body, () => {
    const updated = {
      code: document.getElementById('mdTbCode').value.trim(),
      level: document.getElementById('mdTbLevel').value.trim(),
      desc: document.getElementById('mdTbDesc').value.trim()
    };
    if (!updated.code) { alert('Turnback code is required.'); return; }
    if (!field.turnbacks) field.turnbacks = [];
    if (isEdit) {
      field.turnbacks[ti] = updated;
    } else {
      field.turnbacks.push(updated);
    }
    saveData(appData);
    refreshPanel();
    closeModal();
  });
}

function deleteTb(ti) {
  const ctx = currentPanelCtx;
  const field = appData[ctx.formKey][ctx.fieldIdx];
  field.turnbacks.splice(ti, 1);
  saveData(appData);
  refreshPanel();
}

// ────────────────────────── Legend (Color Pool) ──────────────────────────

function applyCustomColors() {
  // Inject CSS custom properties for every color in the pool.
  // Built-in colors are already in :root via styles.css, but user-added ones
  // need a dynamic <style> block. We also re-apply built-in ones so that
  // user edits to hex values take effect immediately.
  let styleEl = document.getElementById('fairwell-dynamic-colors');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'fairwell-dynamic-colors';
    document.head.appendChild(styleEl);
  }
  const colors = getColors(appData);
  const darkVars = colors.map(c => `  --${c.id}: ${c.hex};`).join('\n');
  // For light mode, use the same hex — artic.css seed overrides will be
  // superseded by this dynamic block, keeping user edits consistent.
  const lightVars = colors.map(c => `  --${c.id}: ${c.hex};`).join('\n');
  styleEl.textContent = `:root {\n${darkVars}\n}\nbody.light-mode {\n${lightVars}\n}`;
}

function renderLegend() {
  const container = document.getElementById('legendContainer');
  if (!container) return;
  const colors = getColors(appData);
  let html = '';
  colors.forEach((c, idx) => {
    html += `<div class="legend-item">
      <div class="legend-dot" style="background:var(--${c.id})"></div>
      <span class="legend-label">${esc(c.label)}</span>
      <div class="legend-actions">
        <button class="icon-btn-sm edit-color" data-ci="${idx}" title="Edit color">&#9998;</button>
        <button class="icon-btn-sm del-color" data-ci="${idx}" title="Delete color">&times;</button>
      </div>
    </div>`;
  });
  html += `<button class="legend-add-btn" id="addColorBtn">+ Add Legend</button>`;
  container.innerHTML = html;

  // Wire buttons
  document.getElementById('addColorBtn').onclick = () => openColorModal(-1);
  container.querySelectorAll('.edit-color').forEach(btn => {
    btn.onclick = () => openColorModal(parseInt(btn.dataset.ci));
  });
  container.querySelectorAll('.del-color').forEach(btn => {
    btn.onclick = () => deleteColor(parseInt(btn.dataset.ci));
  });
}

function openColorModal(ci) {
  const isEdit = ci >= 0;
  const colors = getColors(appData);
  const color = isEdit ? colors[ci] : { id: '', label: '', hex: '#3b82f6' };

  const body = `
    <div class="modal-field">
      <label>Label</label>
      <input type="text" class="modal-input" id="mdColorLabel" value="${esc(color.label)}" placeholder="e.g. Teal (MyDoc)">
    </div>
    <div class="modal-row">
      <div class="modal-field">
        <label>ID (short, no spaces)</label>
        <input type="text" class="modal-input" id="mdColorId" value="${esc(color.id)}" placeholder="e.g. mydoc" ${isEdit ? 'disabled' : ''}>
      </div>
      <div class="modal-field">
        <label>Color</label>
        <div class="color-picker-row">
          <input type="color" class="modal-color-input" id="mdColorHex" value="${color.hex}">
          <input type="text" class="modal-input modal-hex-input" id="mdColorHexText" value="${esc(color.hex)}" placeholder="#3b82f6">
        </div>
      </div>
    </div>
  `;

  openModal(isEdit ? 'Edit Legend' : 'Add Legend', body, () => {
    const label = document.getElementById('mdColorLabel').value.trim();
    const id = isEdit ? color.id : document.getElementById('mdColorId').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const hex = document.getElementById('mdColorHex').value;
    if (!label) { alert('Label is required.'); return; }
    if (!id) { alert('ID is required.'); return; }
    // Check for duplicate ID on add
    if (!isEdit && colors.some(c => c.id === id)) {
      alert('A color with this ID already exists.'); return;
    }
    const updated = { id, label, hex };
    if (!appData.colors) appData.colors = [];
    if (isEdit) {
      appData.colors[ci] = updated;
    } else {
      appData.colors.push(updated);
    }
    saveData(appData);
    renderAll();
    closeModal();
  });

  // Sync color picker ↔ hex text input
  const pickerEl = document.getElementById('mdColorHex');
  const textEl = document.getElementById('mdColorHexText');
  pickerEl.oninput = () => { textEl.value = pickerEl.value; };
  textEl.oninput = () => {
    const v = textEl.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) pickerEl.value = v;
  };
}

function deleteColor(ci) {
  const colors = getColors(appData);
  const color = colors[ci];
  if (!confirm(`Delete color "${color.label}"? References using this color will fall back to blue.`)) return;
  appData.colors.splice(ci, 1);
  saveData(appData);
  renderAll();
}



// ────────────────────────── Utilities ──────────────────────────

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ────────────────────────── Data Management ──────────────────────────

function handleExport() {
  exportDataAsJSON(appData);
}

// File System Access API handle for writing edits back to the chosen JSON file.
// Lives only for the current page session; after reload the user must re-Load JSON
// to rebind writes.
let dataFileHandle = null;

async function handleLoadJson() {
  if (!confirm('Load a JSON data file? This replaces current content. If your browser supports it, future edits will save back to this file.')) return;
  try {
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        mode: 'readwrite'
      });
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      dataFileHandle = handle;
      applyImportedData(parsed);
      alert(`Loaded ${handle.name}. Future edits will save back to this file.`);
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    if (err instanceof SyntaxError) { alert('Failed to parse selected file as JSON.'); return; }
    // Fall through to legacy input[type=file]
  }
  // Fallback: read-only file picker (browsers without File System Access API)
  pickFile(async (file) => {
    try {
      applyImportedData(JSON.parse(await file.text()));
      alert('Loaded (read-only — this browser cannot write back automatically; use Export JSON to save changes).');
    } catch {
      alert('Failed to parse selected file as JSON.');
    }
  });
}

async function writeToDataFile(jsonText) {
  if (!dataFileHandle) return;
  try {
    if (dataFileHandle.queryPermission) {
      let perm = await dataFileHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await dataFileHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') { dataFileHandle = null; return; }
      }
    }
    const writable = await dataFileHandle.createWritable();
    await writable.write(jsonText);
    await writable.close();
  } catch (err) {
    console.error('Failed to write bound JSON file:', err);
  }
}

function applyImportedData(imported) {
  if (!imported || typeof imported !== 'object') {
    alert('Invalid data format.');
    return;
  }
  if (!imported.colors) imported.colors = JSON.parse(JSON.stringify(SEED_COLORS));
  if (!imported.types) imported.types = JSON.parse(JSON.stringify(SEED_TYPES));
  if (!imported.hierarchy) imported.hierarchy = [];
  if (!imported.decisionFlow) imported.decisionFlow = [];
  if (!imported.documents) imported.documents = [];
  if (!imported.form1Fields) imported.form1Fields = [];
  if (!imported.form2Fields) imported.form2Fields = [];
  if (!imported.form3Fields) imported.form3Fields = [];
  if (!Array.isArray(imported.reviewTurnbacks)) imported.reviewTurnbacks = [];
  if (!imported.reviewRefMeta || typeof imported.reviewRefMeta !== 'object') imported.reviewRefMeta = {};
  if (!Array.isArray(imported.specialChars)) imported.specialChars = JSON.parse(JSON.stringify(SEED_SPECIAL_CHARS));
  backfillDocTypes(imported);
  appData = imported;
  saveData(appData);
  renderAll();
  closePanel();
}

function handleReset() {
  if (!confirm('Reset all data to defaults? This will erase your edits and unbind any loaded JSON file.')) return;
  dataFileHandle = null;
  appData = resetToDefaults();
  renderAll();
  closePanel();
}

// ────────────────────────── Theme Toggle ──────────────────────────

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('fairwell_theme', isLight ? 'light' : 'dark');
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const isLight = document.body.classList.contains('light-mode');
  btn.innerHTML = isLight ? '&#9728;' : '&#9790;';
  btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
}

function restoreTheme() {
  const saved = localStorage.getItem('fairwell_theme');
  if (saved === 'light') {
    document.body.classList.add('light-mode');
  }
  updateThemeIcon();
}

// ────────────────────────── Init ──────────────────────────

function renderSpecialChars() {
  const bar = document.getElementById('specialCharsBar');
  if (!bar) return;
  const chars = appData.specialChars || [];
  bar.innerHTML = '';
  chars.forEach((ch, idx) => {
    const pill = document.createElement('span');
    pill.className = 'special-char';
    pill.title = 'Click to copy — right-click to remove';
    pill.innerHTML = `<span class="special-char-glyph">${esc(ch)}</span><button class="special-char-remove" title="Remove">&times;</button>`;
    pill.querySelector('.special-char-glyph').onclick = () => copySpecialChar(ch, pill);
    pill.querySelector('.special-char-remove').onclick = (e) => { e.stopPropagation(); removeSpecialChar(idx); };
    bar.appendChild(pill);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'special-char-add';
  addBtn.textContent = '+';
  addBtn.title = 'Add a special character';
  addBtn.onclick = addSpecialChar;
  bar.appendChild(addBtn);
}

function copySpecialChar(ch, el) {
  const done = () => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ch).then(done).catch(() => done());
  } else {
    const ta = document.createElement('textarea');
    ta.value = ch;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    done();
  }
}

function addSpecialChar() {
  const input = prompt('Enter a special character (or short string) to add:');
  if (input === null) return;
  const ch = input.trim();
  if (!ch) return;
  if (!Array.isArray(appData.specialChars)) appData.specialChars = [];
  if (appData.specialChars.includes(ch)) { alert('That character is already in the list.'); return; }
  appData.specialChars.push(ch);
  saveData(appData);
  renderSpecialChars();
}

function removeSpecialChar(idx) {
  if (!appData.specialChars || idx < 0 || idx >= appData.specialChars.length) return;
  appData.specialChars.splice(idx, 1);
  saveData(appData);
  renderSpecialChars();
}

function renderAll() {
  applyCustomColors();
  renderLegend();
  renderSpecialChars();
  renderSectionDescriptions();
  renderDocGrid();
  renderHierarchy();
  renderDecisionFlow();
  renderAllForms();
  if (typeof renderReviewMode === 'function') renderReviewMode();
}

// ────────────────────────── Section Descriptions ──────────────────────────

const SECTION_DESC_SEEDS = {};

function captureSectionDescSeeds() {
  document.querySelectorAll('.section-desc[data-section-desc]').forEach(el => {
    const key = el.dataset.sectionDesc;
    if (!(key in SECTION_DESC_SEEDS)) SECTION_DESC_SEEDS[key] = el.innerHTML;
  });
}

function renderSectionDescriptions() {
  if (!appData.descriptions) appData.descriptions = {};
  document.querySelectorAll('.section-desc[data-section-desc]').forEach(el => {
    if (el.classList.contains('editing')) return;
    const key = el.dataset.sectionDesc;
    const stored = appData.descriptions[key];
    el.innerHTML = (stored != null && stored !== '')
      ? esc(stored).replace(/\n/g, '<br>')
      : (SECTION_DESC_SEEDS[key] || '');
    if (!el.dataset.editBound) {
      el.addEventListener('click', e => {
        if (el.classList.contains('editing')) return;
        if (e.target.closest('a')) return;
        beginSectionDescEdit(el);
      });
      el.dataset.editBound = '1';
    }
    el.title = 'Click to edit';
  });
}

function beginSectionDescEdit(el) {
  const key = el.dataset.sectionDesc;
  const stored = appData.descriptions && appData.descriptions[key];
  const current = (stored != null && stored !== '')
    ? stored
    : sectionDescSeedAsText(key);
  el.classList.add('editing');
  el.innerHTML = `
    <textarea class="modal-input modal-textarea section-desc-textarea"></textarea>
    <div class="section-desc-edit-actions">
      <button type="button" class="modal-cancel-btn section-desc-reset" title="Restore the built-in default for this section">Reset to default</button>
      <span class="section-desc-edit-spacer"></span>
      <button type="button" class="modal-cancel-btn section-desc-cancel">Cancel</button>
      <button type="button" class="modal-save-btn section-desc-save">Save</button>
    </div>
  `;
  const ta = el.querySelector('textarea');
  ta.value = current;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  el.querySelector('.section-desc-save').onclick = (e) => {
    e.stopPropagation();
    const next = ta.value.trim();
    if (!appData.descriptions) appData.descriptions = {};
    if (!next) delete appData.descriptions[key];
    else appData.descriptions[key] = next;
    saveData(appData);
    el.classList.remove('editing');
    renderSectionDescriptions();
  };
  el.querySelector('.section-desc-cancel').onclick = (e) => {
    e.stopPropagation();
    el.classList.remove('editing');
    renderSectionDescriptions();
  };
  el.querySelector('.section-desc-reset').onclick = (e) => {
    e.stopPropagation();
    if (appData.descriptions) delete appData.descriptions[key];
    saveData(appData);
    el.classList.remove('editing');
    renderSectionDescriptions();
  };
}

function sectionDescSeedAsText(key) {
  const html = SECTION_DESC_SEEDS[key] || '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').trim();
}

// ────────────────────────── In-app document viewer ──────────────────────────

const DOC_VIEWER_REGISTRY = {
  readme:     { title: 'README',              path: 'README.md' },
  commercial: { title: 'Commercial Licensing', path: 'COMMERCIAL.md' },
  license:    { title: 'License',             path: 'LICENSE' }
};

function initDocViewer() {
  const overlay = document.getElementById('docViewerOverlay');
  if (!overlay) return;
  const closeBtn = overlay.querySelector('.doc-viewer-close');

  document.querySelectorAll('.footer-license[data-doc]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.doc;
      if (DOC_VIEWER_REGISTRY[key]) openDocViewer(key);
    });
  });

  closeBtn.addEventListener('click', closeDocViewer);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDocViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeDocViewer();
  });

  // Hand-off: links inside the viewer that point at known doc paths swap content
  // in place rather than navigating away.
  overlay.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    const key = Object.keys(DOC_VIEWER_REGISTRY).find(k => DOC_VIEWER_REGISTRY[k].path === href);
    if (key) {
      e.preventDefault();
      openDocViewer(key);
    }
  });
}

async function openDocViewer(key) {
  const reg = DOC_VIEWER_REGISTRY[key];
  if (!reg) return;
  const overlay = document.getElementById('docViewerOverlay');
  const titleEl = document.getElementById('docViewerTitle');
  const bodyEl = document.getElementById('docViewerBody');
  titleEl.textContent = reg.title;
  bodyEl.innerHTML = `<div class="doc-viewer-loading">Loading ${esc(reg.path)}…</div>`;
  overlay.hidden = false;
  bodyEl.scrollTop = 0;

  try {
    const res = await fetch(reg.path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    bodyEl.innerHTML = renderMarkdown(text);
    bodyEl.querySelectorAll('a[href^="http"], a[href^="mailto:"]').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener';
    });
  } catch (err) {
    bodyEl.innerHTML = `
      <div class="doc-viewer-error">
        Couldn't load <code>${esc(reg.path)}</code> in-app${err && err.message ? ` (${esc(err.message)})` : ''}.
        This usually happens when Fairwell is opened from the local filesystem;
        browsers block <code>fetch()</code> against <code>file://</code> URLs.
        <br><br>
        <a href="${esc(reg.path)}" target="_blank" rel="noopener">Open ${esc(reg.path)} in a new tab →</a>
      </div>`;
  }
}

function closeDocViewer() {
  const overlay = document.getElementById('docViewerOverlay');
  if (overlay) overlay.hidden = true;
}

// ── Tiny markdown subset renderer ────────────────────────────────────────────
// Supports: # ## ### headings, paragraphs, **bold**, *italic*, ***both***,
// `inline code`, ```code fences```, [text](url), - lists, > blockquotes,
// horizontal rules (---). Trusted-source markdown only — escapes HTML first.
function renderMarkdown(md) {
  let text = String(md).replace(/\r\n?/g, '\n');

  // Stash code fences so their interiors aren't munged by inline rules.
  const fences = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const i = fences.push(code) - 1;
    return ` FENCE${i} `;
  });

  // Stash inline code for the same reason.
  const inlines = [];
  text = text.replace(/`([^`\n]+?)`/g, (_, code) => {
    const i = inlines.push(code) - 1;
    return ` INLINE${i} `;
  });

  // Escape HTML in everything that remains.
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Block: headings (# ## ### only — keep it tight)
  text = text.replace(/^(#{1,3})\s+(.+)$/gm, (_, h, content) => {
    const level = h.length;
    return ` B <h${level}>${content}</h${level}> B `;
  });

  // Block: horizontal rules
  text = text.replace(/^---+$/gm, ' B <hr> B ');

  // Block: blockquotes — note `>` was escaped to `&gt;`.
  text = text.replace(/(?:^&gt;\s?.*(?:\n|$))+/gm, (block) => {
    const inner = block.split('\n').filter(Boolean)
      .map(l => l.replace(/^&gt;\s?/, '')).join(' ');
    return ` B <blockquote>${inner}</blockquote> B `;
  });

  // Block: unordered lists. Capture consecutive `- ` lines.
  text = text.replace(/(?:^[-*]\s+.+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^[-*]\s+/, '')}</li>`).join('');
    return ` B <ul>${items}</ul> B `;
  });

  // Inline: bold-italic, bold, italic. Order matters.
  text = text.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');

  // Inline: links [text](url). Only allow safe URL schemes.
  text = text.replace(/\[([^\]]+?)\]\(([^)\s]+)\)/g, (m, label, url) => {
    if (/^(https?:|mailto:|#)/.test(url) || !/^[a-z]+:/i.test(url)) {
      return `<a href="${url}">${label}</a>`;
    }
    return m;
  });

  // Paragraphs: split on blank lines, wrap remaining loose text in <p>.
  // Block markers ( B ) keep already-wrapped blocks from being re-wrapped.
  text = text.split(/\n{2,}/).map(chunk => {
    const t = chunk.trim();
    if (!t) return '';
    if (t.includes(' B ')) return t.replace(/ B /g, '');
    return `<p>${t.replace(/\n/g, ' ')}</p>`;
  }).join('\n');

  // Restore inline code.
  text = text.replace(/ INLINE(\d+) /g, (_, i) =>
    `<code>${inlines[Number(i)]
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`);

  // Restore code fences.
  text = text.replace(/ FENCE(\d+) /g, (_, i) =>
    `<pre><code>${fences[Number(i)]
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);

  return text;
}

function initAboutPopover() {
  const btn = document.getElementById('footerIglooBtn');
  const pop = document.getElementById('aboutPopover');
  if (!btn || !pop) return;
  const closeBtn = pop.querySelector('.about-close');
  const setOpen = (open) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(pop.hidden);
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (pop.hidden) return;
    if (e.target.closest('#aboutPopover') || e.target.closest('#footerIglooBtn')) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) setOpen(false);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  restoreTheme();
  captureSectionDescSeeds();
  renderAll();
  initAboutPopover();
  initDocViewer();
  installFileDropGuard();
  if (typeof USE_DOCUMENTS_API !== 'undefined' && USE_DOCUMENTS_API) {
    hydrateCatalogFromApi();
  }
});
