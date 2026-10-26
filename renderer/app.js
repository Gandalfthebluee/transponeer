// Transponeer — interface
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// window.api komt uit preload.cjs

const state = {
  projects: [],
  project: null,      // geopend project (volledig)
  iv: { steps: 0, semis: 0 },
  zoom: 1,
  mode: 'score',
  keyDir: 'nearest',
  pref: 'auto',
  activeVersion: null,
  renderToken: 0,
};

const EXAMPLES = [
  ['3 halve tonen omhoog', ''], ['2 halve tonen omlaag', ''], ['een hele toon omhoog', ''],
  ['van F naar G', 'toonsoort'], ['naar Bes', 'vanuit het origineel'], ['naar fis', ''],
  ['kleine terts omlaag', 'interval'], ['reine kwart omhoog', ''], ['octaaf omhoog', ''],
  ['voor Bes-klarinet', 'instrument'], ['voor altsax', ''], ['+5', 'kort'], ['-2', ''], ['origineel', 'terug'],
];

// ---------- hulpjes ----------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sameIv = (a, b) => a && b && a.steps === b.steps && a.semis === b.semis;
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'home') loadProjects();
}
$$('.tab').forEach(t => t.addEventListener('click', () => !t.disabled && showView(t.dataset.view)));

// ---------- startscherm ----------
async function loadProjects() {
  state.projects = await api.listProjects();
  drawGrid();
}

function drawGrid() {
  const q = $('#search').value.trim().toLowerCase();
  const list = state.projects.filter(p => !q || `${p.title} ${p.composer} ${p.keyName}`.toLowerCase().includes(q));
  const grid = $('#grid');
  grid.innerHTML = '';
  if (!q) {
    const n = document.createElement('button');
    n.className = 'card new';
    n.innerHTML = `<div class="thumb"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>
      <div class="card-title">Nieuw</div><div class="card-sub">PDF, foto of MusicXML</div>`;
    n.onclick = importFiles;
    grid.appendChild(n);
  }
  for (const p of list) grid.appendChild(card(p));
  if (q && !list.length) grid.innerHTML = '<div class="empty">Niets gevonden.</div>';
}

function card(p) {
  const el = document.createElement('button');
  el.className = 'card';
  el.dataset.id = p.id;
  let badge = '';
  if (p.status === 'working') badge = `<div class="badge"><span class="spinner"></span>${esc(p.statusText || 'Bezig…')}</div>`;
  else if (p.status === 'error' || p.status === 'needs-omr') badge = `<div class="badge err">${esc(p.statusText || 'Mislukt')}<button data-retry>Opnieuw</button></div>`;
  const sub = p.status === 'ready'
    ? [p.composer, p.currentKey || p.keyName].filter(Boolean).join(' · ')
    : fmtDate(p.createdAt);
  el.innerHTML = `<div class="thumb">${p.thumb || '<div class="placeholder"></div>'}${badge}</div>
    <div class="card-title">${esc(p.title || 'Naamloos')}</div>
    <div class="card-sub">${esc(sub)}${p.versions ? ` · ${p.versions} versie${p.versions > 1 ? 's' : ''}` : ''}</div>`;
  el.onclick = (e) => {
    if (e.target.closest('[data-retry]')) {
      e.stopPropagation();
      if (p.status === 'needs-omr') return openSettings();
      api.retryOmr(p.id); return;
    }
    openProject(p.id);
  };
  return el;
}

api.onProjectUpdated((s) => {
  const i = state.projects.findIndex(p => p.id === s.id);
  if (i >= 0) state.projects[i] = s; else state.projects.unshift(s);
  if ($('#view-home').classList.contains('active')) drawGrid();
  if (state.project && state.project.id === s.id) {
    const wasReady = state.project.status === 'ready';
    state.project.status = s.status;
    state.project.statusText = s.statusText;
    if (s.status === 'ready' && !wasReady) openProject(s.id);
    else if (s.status !== 'ready') drawScoreState();
  }
});

async function importFiles(files) {
  const created = await api.importFiles(Array.isArray(files) ? files : undefined);
  if (!created.length) return;
  await loadProjects();
  if (created.length === 1) openProject(created[0].id);
  else toast(`${created.length} bestanden geïmporteerd`, 'ok');
}
$('#btn-import').onclick = () => importFiles();
async function pasteImage() {
  const r = await api.paste();
  if (!r) return toast('Er staat geen afbeelding op het klembord. Maak eerst een schermafbeelding (Windows-toets + Shift + S).', 'err');
  await loadProjects();
  openProject(r[0].id);
}
$('#btn-paste').onclick = pasteImage;
document.addEventListener('paste', (e) => {
  if (!$('#view-home').classList.contains('active')) return;
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  e.preventDefault(); pasteImage();
});
$('#search').oninput = drawGrid;
$('#side-folder').onclick = () => api.openFolder();
$('#side-help').onclick = () => $('#dlg-help').showModal();
$('#examples').innerHTML = EXAMPLES.map(([e]) => `<code>${esc(e)}</code>`).join('');

// slepen en neerzetten
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); if ($('#view-home').classList.contains('active')) { dragDepth++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if (!$('#view-home').classList.contains('active')) return;
  const paths = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(p => /\.(pdf|png|jpe?g|tiff?|mxl|musicxml|xml)$/i.test(p));
  if (paths.length) importFiles(paths);
  else toast('Sleep een PDF, foto of MusicXML-bestand hierheen.', 'err');
});

// ---------- editor ----------
async function openProject(id) {
  const p = await api.getProject(id);
  if (!p) return toast('Project niet gevonden', 'err');
  state.project = p;
  state.iv = p.current || { steps: 0, semis: 0 };
  state.activeVersion = (p.versions || []).find(v => sameIv(v.interval, state.iv))?.id || null;
  $('#tab-editor').disabled = false;
  $('#title-input').value = p.title || '';
  $('#composer-input').value = p.composer || '';
  $('#subtitle-input').value = p.subtitle || '';
  $('#instr-from').value = p.fromInstrument || 'c';
  $('#instr-to').value = p.toInstrument || 'c';
  $('#instr-hint').textContent = '';
  $('#notes').value = p.notes || '';
  $('#notes-saved').textContent = '';
  $('#command-msg').textContent = '';
  setEditing(false); state.undo = 0;
  showView('editor');
  drawOriginal();
  drawKeys();
  drawVersions();
  drawScoreState();
}

function drawScoreState() {
  const p = state.project;
  const pane = $('#pane-score');
  const banner = $('#banner');
  banner.className = 'banner';
  if (p.status === 'ready') {
    const E = { audiveris: 'Audiveris', homr: 'homr' };
    const eng = p.engines || {};
    const other = Object.keys(eng).find(n => n !== p.engine && eng[n] && !eng[n].error);
    const cur = eng[p.engine];
    let text = '';
    if (cur && !cur.error) {
      text = `Herkend met ${E[p.engine]}: ${cur.ok} van ${cur.measures} maten kloppen precies.`;
      if (other) text += ` (${E[other]}: ${eng[other].ok} van ${eng[other].measures}.)`;
      if (p.engine === 'homr' && cur.chords) text += ` Akkoorden van Audiveris overgenomen.`;
    }
    if (p.warning) text = (text ? text + ' ' : '') + p.warning;
    if (p.sourceType === 'pdf' || p.engines) {
      if (!p.checked || p.warning) {
        banner.className = 'banner show';
        banner.innerHTML = `<span>${esc(text || 'Controleer de herkende noten met het origineel. Herkenning is nooit 100% foutloos.')}</span>
          ${other ? `<button class="btn" id="b-other">Toon versie van ${E[other]}</button>` : ''}
          <button class="btn" id="b-split">Naast elkaar</button><button class="btn" id="b-fix">Verbeteren</button><button class="btn ghost" id="b-ok">Klopt</button>`;
        $('#b-split').onclick = () => setMode('split');
        $('#b-fix').onclick = () => setEditing(true);
        $('#b-ok').onclick = async () => { p.checked = true; p.warning = ''; await api.updateProject(p.id, { checked: true, warning: '' }); banner.className = 'banner'; };
        if (other) $('#b-other').onclick = async () => { if (await api.useEngine(p.id, other)) { toast(`Nu de versie van ${E[other]}`, 'ok'); openProject(p.id); } };
      }
    }
    render();
    return;
  }
  $('#statusbar').textContent = '';
  if (p.status === 'working') {
    pane.innerHTML = `<div class="loading"><span class="spinner"></span>${esc(p.statusText || 'Noten herkennen…')}</div>`;
  } else {
    banner.className = 'banner show err';
    banner.textContent = p.statusText || 'Er ging iets mis.';
    pane.innerHTML = `<div class="state"><h2>Nog geen noten</h2>
      <p>${p.status === 'needs-omr' ? 'Voor PDF\'s en foto\'s is Audiveris nodig. Installeer het (gratis) en wijs de locatie aan in Instellingen.' : 'De herkenning is niet gelukt. Probeer het opnieuw, of maak de partituur in MuseScore en laad die als MusicXML in.'}</p>
      <button class="btn primary" id="s-retry">${p.status === 'needs-omr' ? 'Instellingen' : 'Opnieuw herkennen'}</button>
      <button class="btn" id="s-replace">MusicXML inladen…</button></div>`;
    $('#s-retry').onclick = () => p.status === 'needs-omr' ? openSettings() : api.retryOmr(p.id);
    $('#s-replace').onclick = () => api.replaceScore(p.id);
    setMode('split');
  }
}

function drawOriginal() {
  const p = state.project;
  const pane = $('#pane-original');
  if (p.sourceType === 'musicxml') { pane.innerHTML = ''; return; } // wordt bij render gevuld
  if (/\.pdf$/i.test(p.originalFile)) {
    const go = async () => window.renderPdfInto(await api.originalBytes(p.id), pane);
    if (window.renderPdfInto) go(); else window.addEventListener('load', go, { once: true });
  }
  else pane.innerHTML = `<img src="${p.originalUrl}" alt="Origineel">`;
}

async function render() {
  const p = state.project;
  if (!p || p.status !== 'ready') return;
  const token = ++state.renderToken;
  updatePanel();
  try {
    const r = await api.render(p.id, state.iv);
    if (token !== state.renderToken) return;
    const pane = $('#pane-score');
    const scrollTop = pane.scrollTop;
    pane.innerHTML = r.pages.map((svg, i) => `<div class="page" title="Pagina ${i + 1}">${i === 0 && r.label ? `<div class="page-label">${esc(r.label)}</div>` : ''}${svg}</div>`).join('');
    pane.scrollTop = scrollTop;
    if (state.editing) markSelection();
    $('#key-now').textContent = r.keyName || '–';
    $('#interval-desc').textContent = r.description;
    $('#statusbar').innerHTML = `<span>${r.pages.length} pagina${r.pages.length > 1 ? "'s" : ''}</span><span>Toonsoort: ${esc(r.keyName)}</span><span>${esc(r.description)}</span><span>Zoom ${Math.round(state.zoom * 100)}%</span>`;
    if (p.sourceType === 'musicxml' && state.mode === 'split') {
      const o = await api.render(p.id, { steps: 0, semis: 0 });
      $('#pane-original').innerHTML = o.pages.map(svg => `<div class="page">${svg}</div>`).join('');
    }
  } catch (e) {
    $('#pane-score').innerHTML = `<div class="state"><h2>Kan niet tekenen</h2><p>${esc(e.message)}</p></div>`;
  }
}

function updatePanel() {
  const p = state.project;
  $('#key-original').textContent = p.keyName || '–';
  $('#semi-value').textContent = (state.iv.semis > 0 ? '+' : state.iv.semis < 0 ? '−' : '') + Math.abs(state.iv.semis);
  const now = $('#key-now').textContent.split(' ')[0].toLowerCase();
  $$('#keys button').forEach(b => b.classList.toggle('on', b.dataset.name.toLowerCase() === now && !sameIv(state.iv, { steps: 0, semis: 0 })));
  $$('#versions li').forEach(li => li.classList.toggle('on', li.dataset.id === state.activeVersion));
}

async function setInterval_(iv, message) {
  state.iv = { steps: iv.steps, semis: iv.semis };
  state.activeVersion = (state.project.versions || []).find(v => sameIv(v.interval, state.iv))?.id || null;
  state.project.current = state.iv;
  api.updateProject(state.project.id, { current: state.iv });
  await render();
  updatePanel();
  if (message) flashCommand(message, true);
}

// toonsoortknoppen
// bovenste rij stamtonen, onderste rij met kruis of mol
const MAJOR_KEYS = [['C', 0], ['D', 0], ['E', 0], ['F', 0], ['G', 0], ['A', 0], ['B', 0], ['C', 1], ['D', -1], ['E', -1], ['F', 1], ['G', -1], ['A', -1], ['B', -1]];
const MINOR_KEYS = [['C', 0], ['D', 0], ['E', 0], ['F', 0], ['G', 0], ['A', 0], ['B', 0], ['C', 1], ['D', 1], ['E', -1], ['F', 1], ['G', 1], ['A', -1], ['B', -1]];
function dutch(letter, alter) {
  if (alter === 0) return letter;
  if (alter > 0) return letter + 'is'.repeat(alter);
  if (letter === 'E' || letter === 'A') return letter + 's';
  return letter + 'es';
}
function drawKeys() {
  const minor = state.project.mode === 'minor';
  const list = minor ? MINOR_KEYS : MAJOR_KEYS;
  const origName = (state.project.keyName || '').split(' ')[0];
  $('#keys').innerHTML = list.map(([l, a]) => {
    const name = dutch(l, a);
    const shown = minor ? name.toLowerCase() : name;
    return `<button data-letter="${l}" data-alter="${a}" data-name="${name}" class="${name.toLowerCase() === origName.toLowerCase() ? 'orig' : ''}" title="${shown} ${minor ? 'mineur' : 'groot'}">${shown}</button>`;
  }).join('');
  $$('#keys button').forEach(b => b.onclick = async () => {
    const iv = await api.interval('key', state.project.id, { letter: b.dataset.letter, alter: +b.dataset.alter, dir: state.keyDir });
    setInterval_(iv, `Naar ${b.textContent} ${minor ? 'mineur' : 'groot'}`);
  });
}

$('#semi-up').onclick = async () => setInterval_(await api.interval('semitones', state.project.id, { semis: state.iv.semis + 1, pref: state.pref }));
$('#semi-down').onclick = async () => setInterval_(await api.interval('semitones', state.project.id, { semis: state.iv.semis - 1, pref: state.pref }));
$('#oct-up').onclick = () => setInterval_({ steps: state.iv.steps + 7, semis: state.iv.semis + 12 });
$('#oct-down').onclick = () => setInterval_({ steps: state.iv.steps - 7, semis: state.iv.semis - 12 });
$('#btn-reset').onclick = async () => {
  state.project.toInstrument = '';
  $('#instr-to').value = $('#instr-from').value;
  $('#instr-hint').textContent = '';
  await api.updateProject(state.project.id, { toInstrument: '' });
  setInterval_({ steps: 0, semis: 0 }, 'Terug naar het origineel');
};
// van instrument → naar instrument
(async () => {
  const list = await api.instruments();
  const opts = list.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
  $('#instr-from').innerHTML = opts; $('#instr-to').innerHTML = opts;
})();
async function applyInstruments() {
  const from = $('#instr-from').value, to = $('#instr-to').value;
  state.project.fromInstrument = from; state.project.toInstrument = to === 'c' && from === 'c' ? '' : to;
  await api.updateProject(state.project.id, { fromInstrument: from, toInstrument: state.project.toInstrument });
  const r = await api.instrumentInterval(state.project.id, from, to, $('#instr-fit').checked);
  const names = (id) => $(`#instr-from option[value="${id}"]`).textContent;
  $('#instr-hint').textContent = r.octave ? `Een octaaf ${r.octave > 0 ? 'hoger' : 'lager'} gezet, zodat het in het bereik van de ${names(to).toLowerCase()} past.` : '';
  setInterval_(r.interval, from === to ? 'Zelfde instrument' : `Van ${names(from)} naar ${names(to)}`);
}
$('#instr-from').onchange = applyInstruments;
$('#instr-to').onchange = applyInstruments;
$('#instr-fit').onchange = applyInstruments;
segmented('#key-dir', 'dir', (v) => state.keyDir = v);
segmented('#pref', 'pref', async (v) => {
  state.pref = v;
  await api.setSettings({ pref: v });
  if (state.iv.semis % 12 !== 0) setInterval_(await api.interval('semitones', state.project.id, { semis: state.iv.semis, pref: v }));
});

function segmented(sel, attr, cb) {
  $$(sel + ' button').forEach(b => b.onclick = () => {
    $$(sel + ' button').forEach(x => x.classList.toggle('on', x === b));
    cb(b.dataset[attr]);
  });
}

// paneeltabbladen
$$('.ptab').forEach(t => t.onclick = () => {
  $$('.ptab').forEach(x => x.classList.toggle('on', x === t));
  $$('.ptab-body').forEach(b => b.classList.toggle('on', b.id === 'ptab-' + t.dataset.ptab));
});

// weergave
function setMode(m) {
  state.mode = m;
  $$('#viewmode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#canvas').classList.toggle('split', m === 'split');
  if (state.project?.sourceType === 'musicxml' && m === 'split') render();
}
$$('#viewmode button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
function setZoom(z) {
  state.zoom = Math.min(2.5, Math.max(0.4, Math.round(z * 10) / 10));
  document.documentElement.style.setProperty('--zoom', state.zoom);
  $('#zoom-label').textContent = Math.round(state.zoom * 100) + '%';
  const sb = $('#statusbar').lastElementChild; if (sb) sb.textContent = `Zoom ${Math.round(state.zoom * 100)}%`;
}
$('#zoom-in').onclick = () => setZoom(state.zoom + 0.1);
$('#zoom-out').onclick = () => setZoom(state.zoom - 0.1);
$('#pane-score').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(state.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); } }, { passive: false });

// titel & notities
$('#title-input').addEventListener('change', async (e) => {
  const title = e.target.value.trim() || 'Naamloos';
  state.project.title = title;
  await api.updateProject(state.project.id, { title });
  render();
});
$('#composer-input').addEventListener('change', async (e) => {
  state.project.composer = e.target.value.trim();
  await api.updateProject(state.project.id, { composer: state.project.composer });
  render();
});
$('#subtitle-input').addEventListener('change', async (e) => {
  state.project.subtitle = e.target.value.trim();
  await api.updateProject(state.project.id, { subtitle: state.project.subtitle });
  render();
});
$('#subtitle-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#composer-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#title-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
let notesTimer;
$('#notes').addEventListener('input', () => {
  clearTimeout(notesTimer);
  $('#notes-saved').textContent = '…';
  notesTimer = setTimeout(async () => {
    await api.updateProject(state.project.id, { notes: $('#notes').value });
    $('#notes-saved').textContent = 'Opgeslagen';
  }, 500);
});

// versies
function drawVersions() {
  const vs = state.project.versions || [];
  $('#versions').innerHTML = vs.length ? vs.map(v => `<li data-id="${v.id}">
      <div class="grow"><div class="vname">${esc(v.name)}</div><div class="vkey">${esc(v.keyName)} · ${esc(v.description)}</div></div>
      <button class="icon-btn small del" title="Verwijderen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </li>`).join('') : '<li class="empty" style="cursor:default;border:0;background:none;padding:0;color:var(--muted)">Nog geen versies opgeslagen.</li>';
  $$('#versions li[data-id]').forEach(li => {
    li.onclick = (e) => {
      const v = vs.find(x => x.id === li.dataset.id);
      if (e.target.closest('.del')) {
        state.project.versions = vs.filter(x => x.id !== v.id);
        api.updateProject(state.project.id, { versions: state.project.versions });
        drawVersions(); return;
      }
      setInterval_(v.interval, `Versie "${v.name}"`);
    };
  });
  updatePanel();
}
async function saveVersion() {
  const name = $('#version-name').value.trim() || $('#key-now').textContent;
  const v = { id: crypto.randomUUID(), name, interval: state.iv, keyName: $('#key-now').textContent, description: $('#interval-desc').textContent, createdAt: new Date().toISOString() };
  state.project.versions = [...(state.project.versions || []), v];
  state.activeVersion = v.id;
  await api.updateProject(state.project.id, { versions: state.project.versions });
  $('#version-name').value = '';
  drawVersions();
  toast(`Versie "${name}" bewaard`, 'ok');
}
$('#btn-save-version').onclick = saveVersion;
$('#version-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveVersion(); });

// ---------- noten verbeteren ----------
state.editing = false; state.sel = null; state.undo = 0;
function setEditing(on) {
  if (on && state.project?.status !== 'ready') return toast('Er is nog geen herkende partituur.', 'err');
  const was = state.editing;
  state.editing = on; state.sel = null;
  $('#btn-edit').classList.toggle('on', on);
  $('#editbar').classList.toggle('show', on);
  $('#pane-score').classList.toggle('editing', on);
  if (on) { setMode('split'); updateEditBar(); }
  else { $$('.page g.sel').forEach(g => g.classList.remove('sel')); if (was) api.refreshThumb(state.project.id); }
}
function selectedEl() { return state.sel === null ? null : $(`#pane-score g[id="tp${state.sel}"]`); }
function markSelection() {
  $$('#pane-score g.sel').forEach(g => g.classList.remove('sel'));
  const g = selectedEl(); if (g) g.classList.add('sel');
  updateEditBar();
}
function updateEditBar() {
  const g = selectedEl();
  const isRest = g && /rest/i.test(g.getAttribute('class') || '');
  const isMRest = g && /mRest/.test(g.getAttribute('class') || '');
  $('#edit-hint').textContent = !g ? 'Klik op een noot of rust' : isRest ? 'Rust geselecteerd' : 'Noot geselecteerd · ←/→ volgende';
  $$('#editbar [data-ed]').forEach(b => {
    const a = b.dataset.ed;
    if (a === 'done') return;
    if (a === 'undo') { b.disabled = !state.undo; return; }
    b.disabled = !g || (isRest ? (a !== 'note' || isMRest) : a === 'note');
  });
}
async function doEdit(action) {
  if (action === 'done') return setEditing(false);
  if (action === 'undo') {
    const r = await api.undoEdit(state.project.id); state.undo = r.undo; await render(); return;
  }
  if (state.sel === null) return;
  const act = action === 'note' ? 'note' : action;
  try {
    const r = await api.editNote(state.project.id, state.iv, state.sel, act === 'note' ? 'up' : act);
    state.undo = r.undo;
    await render();
  } catch (e) { toast('Bewerken lukte niet: ' + e.message, 'err'); }
}
$('#btn-edit').onclick = () => setEditing(!state.editing);
$$('#editbar [data-ed]').forEach(b => b.onclick = () => doEdit(b.dataset.ed));
$('#pane-score').addEventListener('click', (e) => {
  if (!state.editing) return;
  const g = e.target.closest('g[id^="tp"]');
  if (!g) return;
  state.sel = parseInt(g.id.slice(2), 10);
  markSelection();
});
function editKeys(e) {
  const k = e.key;
  if (k === 'Escape') { setEditing(false); return true; }
  if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { doEdit('undo'); return true; }
  if (state.sel === null) return false;
  const total = $$('#pane-score g[id^="tp"]').length;
  if (k === 'ArrowRight') { state.sel = Math.min(state.sel + 1, total - 1); markSelection(); selectedEl()?.scrollIntoView({ block: 'nearest' }); return true; }
  if (k === 'ArrowLeft') { state.sel = Math.max(state.sel - 1, 0); markSelection(); selectedEl()?.scrollIntoView({ block: 'nearest' }); return true; }
  const isRest = /rest/i.test(selectedEl()?.getAttribute('class') || '');
  if (isRest) { if (k === 'Enter') { doEdit('note'); return true; } return false; }
  const map = { ArrowUp: e.shiftKey ? 'octUp' : 'up', ArrowDown: e.shiftKey ? 'octDown' : 'down', '#': 'sharp', '+': 'sharp', b: 'flat', '-': 'flat', n: 'natural', Delete: 'rest', Backspace: 'rest' };
  const a = map[k];
  if (a) { doEdit(a); return true; }
  return false;
}

// ---------- opdrachtregel ----------
const cmd = $('#command');
let hl = -1;
function flashCommand(msg, ok) {
  const el = $('#command-msg');
  el.textContent = msg;
  el.className = 'command-msg' + (ok ? ' ok' : '');
  clearTimeout(flashCommand.t);
  flashCommand.t = setTimeout(() => (el.textContent = ''), ok ? 2500 : 6000);
}
function drawSuggest() {
  const q = cmd.value.trim().toLowerCase();
  const items = EXAMPLES.filter(([e]) => !q || e.includes(q)).slice(0, 7);
  const box = $('#suggest');
  if (!items.length || document.activeElement !== cmd) { box.classList.remove('open'); return; }
  box.innerHTML = items.map(([e, h], i) => `<button data-v="${esc(e)}" class="${i === hl ? 'hl' : ''}">${esc(e)}${h ? `<small>${esc(h)}</small>` : ''}</button>`).join('');
  box.classList.add('open');
  $$('#suggest button').forEach(b => b.onmousedown = (ev) => { ev.preventDefault(); cmd.value = b.dataset.v; runCommand(); });
}
async function runCommand() {
  const text = cmd.value;
  $('#suggest').classList.remove('open');
  if (!state.project || state.project.status !== 'ready') return flashCommand('Er is nog geen herkende partituur.', false);
  const r = await api.parseCommand(state.project.id, text);
  if (r.type === 'error') return flashCommand(r.message, false);
  if (r.instrument) { cmd.value = ''; $('#instr-to').value = r.instrument; return applyInstruments(); }
  const iv = r.type === 'add' ? { steps: state.iv.steps + r.interval.steps, semis: state.iv.semis + r.interval.semis } : r.interval;
  cmd.value = '';
  setInterval_(iv, r.message);
}
cmd.addEventListener('focus', () => { hl = -1; drawSuggest(); });
cmd.addEventListener('blur', () => setTimeout(() => $('#suggest').classList.remove('open'), 100));
cmd.addEventListener('input', () => { hl = -1; drawSuggest(); });
cmd.addEventListener('keydown', (e) => {
  const items = $$('#suggest button');
  if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); hl = (hl + 1) % items.length; drawSuggest(); }
  else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); hl = (hl - 1 + items.length) % items.length; drawSuggest(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (hl >= 0 && items[hl]) cmd.value = items[hl].dataset.v; runCommand(); }
  else if (e.key === 'Escape') { cmd.blur(); }
});

// ---------- export & menu ----------
const versionLabel = () => sameIv(state.iv, { steps: 0, semis: 0 }) ? '' : ((state.project.versions || []).find(v => v.id === state.activeVersion)?.name || $('#key-now').textContent);
$('#btn-pdf').onclick = async () => {
  if (state.project?.status !== 'ready') return toast('Er is nog geen herkende partituur.', 'err');
  const f = await api.exportPdf(state.project.id, state.iv, versionLabel());
  if (f) toast('PDF opgeslagen: ' + f.split(/[\\/]/).pop(), 'ok');
};
$('#btn-more').onclick = (e) => { e.stopPropagation(); $('#more-menu').classList.toggle('open'); };
document.addEventListener('click', () => $('#more-menu').classList.remove('open'));
$$('#more-menu button').forEach(b => b.onclick = async () => {
  const p = state.project;
  const ready = p.status === 'ready';
  switch (b.dataset.act) {
    case 'musicxml': {
      if (!ready) return toast('Er is nog geen herkende partituur.', 'err');
      const f = await api.exportMusicXml(p.id, state.iv, versionLabel());
      if (f) toast('MusicXML opgeslagen', 'ok'); break;
    }
    case 'musescore': {
      if (!ready) return toast('Er is nog geen herkende partituur.', 'err');
      const r = await api.openInMuseScore(p.id, state.iv);
      if (r !== true) toast('Kon niet openen: ' + r, 'err');
      else toast('Geopend. Verbeteringen gemaakt? Sla op als MusicXML en kies "Gecorrigeerde versie inladen".');
      break;
    }
    case 'replace': if (await api.replaceScore(p.id)) { toast('Partituur vervangen', 'ok'); openProject(p.id); } break;
    case 'original': api.openOriginal(p.id); break;
    case 'retry':
      if (p.sourceType !== 'pdf') return toast('Dit project komt uit een MusicXML-bestand; er valt niets te herkennen.');
      api.retryOmr(p.id); p.status = 'working'; drawScoreState(); break;
    case 'folder': api.openFolder(p.id); break;
    case 'delete':
      if (await api.deleteProject(p.id)) { state.project = null; $('#tab-editor').disabled = true; showView('home'); }
      break;
  }
});
$('#btn-back').onclick = () => showView('home');

// ---------- instellingen ----------
async function openSettings() {
  const s = await api.getSettings();
  fillSettings(s);
  $('#dlg-settings').showModal();
}
function fillSettings(s) {
  $('#aud-path').textContent = s.bundled ? 'Ingebouwd (Audiveris 5.11)' : (s.detected || 'Niet gevonden');
  $('#app-version').textContent = s.version || '';
  $('#aud-hint').innerHTML = s.bundled
    ? 'Zit in de app; je hoeft niets te installeren. Met "Kies…" kun je een andere versie gebruiken.'
    : s.detected
    ? 'Gevonden. PDF\'s en foto\'s worden automatisch herkend.'
    : 'Installeer Audiveris (gratis) via <a href="#" id="aud-link">github.com/Audiveris/audiveris/releases</a> en kies daarna het bestand <code>Audiveris.exe</code> (meestal in C:\\Program Files\\Audiveris).';
  const l = $('#aud-link'); if (l) l.onclick = (e) => { e.preventDefault(); api.openUrl('https://github.com/Audiveris/audiveris/releases'); };
  $('#scale').value = s.scale || 50;
  $('#scale-val').textContent = (s.scale || 50) + '%';
  $('#data-dir').textContent = s.dataDir;
  drawOmrStatus(s);
}
function drawOmrStatus(s) {
  $('#omr-status').innerHTML = s.detected
    ? `<span class="dot" style="background:var(--ok)"></span>Notenherkenning klaar${s.version ? `<br>Versie ${s.version}` : ''}`
    : `<span class="dot" style="background:var(--warn)"></span>Audiveris niet gevonden<br><a id="omr-fix">Instellen</a> om PDF's te kunnen lezen`;
  const f = $('#omr-fix'); if (f) f.onclick = openSettings;
}
$('#btn-settings').onclick = openSettings;
$('#btn-pick-aud').onclick = async () => { const s = await api.pickAudiveris(); if (s) fillSettings(s); };
$('#scale').oninput = (e) => { $('#scale-val').textContent = e.target.value + '%'; };
$('#scale').onchange = async (e) => { await api.setSettings({ scale: +e.target.value }); if (state.project) render(); };

// ---------- sneltoetsen ----------
document.addEventListener('keydown', (e) => {
  if (!$('#view-editor').classList.contains('active')) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (state.editing && !typing) { if (editKeys(e)) { e.preventDefault(); return; } }
  if (!typing && !e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); setEditing(!state.editing); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); cmd.focus(); }
  else if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(state.zoom + 0.1); }
  else if (e.ctrlKey && e.key === '-') { e.preventDefault(); setZoom(state.zoom - 0.1); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); $('#btn-pdf').click(); }
  else if (!typing && e.key === 'ArrowUp') { e.preventDefault(); $('#semi-up').click(); }
  else if (!typing && e.key === 'ArrowDown') { e.preventDefault(); $('#semi-down').click(); }
});

// ---------- updates ----------
function updateText(u) {
  switch (u.state) {
    case 'checking': return 'Controleren op updates…';
    case 'downloading': return `Update ${u.version || ''} downloaden… ${u.percent ?? 0}%`;
    case 'ready': return `Versie ${u.version} staat klaar`;
    case 'latest': return 'Je hebt de nieuwste versie';
    case 'error': return u.message || 'Controleren lukte niet';
    case 'dev': return 'Ontwikkelversie (geen updates)';
    default: return '';
  }
}
let readyToastShown = false;
function drawUpdate(u) {
  const el = $('#update-status');
  const t = updateText(u);
  el.innerHTML = !t ? '' : `<span class="dot" style="background:${u.state === 'ready' ? 'var(--accent)' : u.state === 'error' ? 'var(--warn)' : 'var(--ok)'}"></span>${esc(t)}`
    + (u.state === 'downloading' ? `<div class="bar"><i style="width:${u.percent || 0}%"></i></div>` : '')
    + (u.state === 'ready' ? `<br><button class="btn primary upd-btn" id="upd-now">Nu herstarten</button>` : '');
  const b = $('#upd-now'); if (b) b.onclick = () => api.installUpdate();
  const ut = $('#upd-text'); if (ut) ut.textContent = t || '–';
  if (u.state === 'ready' && !readyToastShown) {
    readyToastShown = true;
    const el2 = document.createElement('div');
    el2.className = 'toast ok';
    el2.innerHTML = `Versie ${esc(u.version)} van Transponeer staat klaar. Je stukken blijven bewaard.<br><button class="btn primary">Nu herstarten</button> <button class="btn ghost">Later</button>`;
    el2.querySelector('.primary').onclick = () => api.installUpdate();
    el2.querySelector('.ghost').onclick = () => el2.remove();
    $('#toasts').appendChild(el2);
  }
}
api.onUpdateStatus(drawUpdate);
$('#btn-check-upd').onclick = async () => drawUpdate(await api.checkForUpdates());

async function showWhatsNew() {
  const n = await api.whatsNew();
  if (!n) return;
  $('#new-title').textContent = `Bijgewerkt naar versie ${n.to}`;
  $('#new-items').innerHTML = (n.items.length ? n.items : ['Kleine verbeteringen.']).map(i => `<li>${esc(i)}</li>`).join('');
  $('#dlg-new').showModal();
}

// start
(async () => {
  drawUpdate(await api.updateStatus());
  showWhatsNew();
  const s = await api.getSettings();
  state.pref = s.pref || 'auto';
  $$('#pref button').forEach(b => b.classList.toggle('on', b.dataset.pref === state.pref));
  drawOmrStatus(s);
  loadProjects();
})();
