// FAIRWELL — vanilla seed data + localStorage persistence.
// The default state is empty. Project-specific content (documents, hierarchy,
// decision flow, form fields, types) lives in data.json and is loaded via the
// "Load Seed Data" action in the toolbar. Edits made in the UI are saved to
// localStorage.

// Vanilla default color palette.
const SEED_COLORS = [
  { id: "color1", label: "Violet",  hex: "#8b5cf6" },
  { id: "color2", label: "Emerald", hex: "#10b981" },
  { id: "color3", label: "Amber",   hex: "#f59e0b" },
  { id: "color4", label: "Blue",    hex: "#3b82f6" },
  { id: "color5", label: "Cyan",    hex: "#06b6d4" },
  { id: "color6", label: "Rose",    hex: "#f43f5e" },
];

// Vanilla default types.
const SEED_TYPES = [
  { id: "default", label: "DEFAULT", colorId: "color4" },
];

function getColors(data) {
  return (data && data.colors) || SEED_COLORS;
}

function getTypes(data) {
  return (data && data.types) || SEED_TYPES;
}

function colorCssById(id, data) {
  const colors = getColors(data);
  const found = colors.find(c => c.id === id);
  return found ? `var(--${found.id})` : "var(--accent-blue)";
}

function getColorOptions(data) {
  return getColors(data).map(c => ({ id: c.id, label: c.label, css: `var(--${c.id})` }));
}

function getTypeOptions(data) {
  return getTypes(data).map(t => ({ id: t.id, label: t.label, colorId: t.colorId }));
}

// Infer a typeId for a document based on its badge text (first) or colorClass.
function inferDocTypeId(doc, data) {
  const types = getTypes(data);
  if (doc.typeId && types.find(t => t.id === doc.typeId)) return doc.typeId;
  if (doc.badge) {
    const byBadge = types.find(t => t.label.toLowerCase() === String(doc.badge).toLowerCase());
    if (byBadge) return byBadge.id;
  }
  if (doc.colorClass) {
    const byColor = types.find(t => t.colorId === doc.colorClass);
    if (byColor) return byColor.id;
  }
  return types[0] && types[0].id;
}

const SEED_SPECIAL_CHARS = ["\u00A7", "\u2192", "\u2014"];

const SEED_DATA = {
  colors: JSON.parse(JSON.stringify(SEED_COLORS)),
  types: JSON.parse(JSON.stringify(SEED_TYPES)),
  hierarchy: [],
  decisionFlow: [],
  documents: [],
  form1Fields: [],
  form2Fields: [],
  form3Fields: [],
  specialChars: JSON.parse(JSON.stringify(SEED_SPECIAL_CHARS)),
  reviewTurnbacks: [],
  reviewRefMeta: {},
  descriptions: {}
};

// --------------- persistence helpers ---------------

const STORAGE_KEY = "fairwell_data";

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      // Backfill fields for data saved before these features were added
      if (!data.colors) data.colors = JSON.parse(JSON.stringify(SEED_COLORS));
      if (!data.types) data.types = JSON.parse(JSON.stringify(SEED_TYPES));
      if (!data.hierarchy) data.hierarchy = [];
      if (!data.decisionFlow) data.decisionFlow = [];
      if (!data.documents) data.documents = [];
      if (!data.form1Fields) data.form1Fields = [];
      if (!data.form2Fields) data.form2Fields = [];
      if (!data.form3Fields) data.form3Fields = [];
      if (!data.specialChars) data.specialChars = JSON.parse(JSON.stringify(SEED_SPECIAL_CHARS));
      if (!Array.isArray(data.reviewTurnbacks)) data.reviewTurnbacks = [];
      if (!data.reviewRefMeta || typeof data.reviewRefMeta !== 'object') data.reviewRefMeta = {};
      if (!data.descriptions || typeof data.descriptions !== 'object') data.descriptions = {};
      backfillDocTypes(data);
      return data;
    }
  } catch (e) { /* corrupted — fall through */ }
  const fresh = JSON.parse(JSON.stringify(SEED_DATA));
  backfillDocTypes(fresh);
  return fresh;
}

function backfillDocTypes(data) {
  if (!Array.isArray(data.documents)) return;
  data.documents.forEach(doc => {
    if (!doc.typeId) doc.typeId = inferDocTypeId(doc, data);
  });
}

function saveData(data) {
  const json = JSON.stringify(data, null, 2);
  localStorage.setItem(STORAGE_KEY, json);
  // If a JSON file is bound via "Load JSON", mirror writes there.
  if (typeof writeToDataFile === 'function') writeToDataFile(json);
}

function resetToDefaults() {
  localStorage.removeItem(STORAGE_KEY);
  return JSON.parse(JSON.stringify(SEED_DATA));
}

function exportDataAsJSON(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fairwell-data.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
