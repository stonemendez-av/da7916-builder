import * as pdfjsLib from '../lib/pdf.min.mjs';
import * as PDFLib from '../lib/pdf-lib.esm.min.js';
import { parseNavlog, fmtTime, isAirport } from './navlog.js';
import { parseMobileNavlog, pairWithNavlog, isMobileNavlogText } from './mobile.js';
import { computeCard, prettyMgrs, mgrsToLatLon, reserveMinutes } from './calc.js';
import { build7916 } from './fill7916.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', import.meta.url).href;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { nav: null, rows: [], rules: 'VFR', rulesAuto: false, routeEdited: false, fileName: '', templateBytes: null, lastUrl: null };

/* ---------- small persistence for repeat values (burn, fuel, IAS...) ---------- */
const store = {
  get(k) { try { return localStorage.getItem('da7916:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('da7916:' + k, v); } catch { /* storage unavailable */ } },
};
for (const el of $$('[data-save]')) {
  const v = store.get(el.id);
  if (v != null && v !== '') el.value = v;
  el.addEventListener('change', () => store.set(el.id, el.value));
}

/* ---------- WP naming: SP/ACP/CP/RP use numbers, LZ = birds, PZ = trees ---------- */
const WP_TYPES = ['SP', 'ACP', 'CP', 'RP', 'LZ', 'PZ'];
const NAMED = { LZ: 'lzNames', PZ: 'pzNames' };
const DEFAULT_NAMES = {
  lzNames: 'Eagle, Hawk, Falcon, Raven, Osprey, Condor, Owl, Heron, Pelican, Crow, Kestrel, Cardinal, Robin, Sparrow, Finch, Bluejay, Magpie, Oriole, Wren, Vulture, Albatross, Kingfisher, Swallow, Starling',
  pzNames: 'Oak, Pine, Maple, Aspen, Birch, Cedar, Elm, Spruce, Willow, Cottonwood, Juniper, Fir, Hickory, Walnut, Ash, Cypress, Redwood, Sequoia, Poplar, Dogwood, Magnolia, Sycamore, Hemlock, Chestnut',
};
for (const id of Object.keys(DEFAULT_NAMES)) {
  const el = $('#' + id);
  el.value = store.get(id) ?? DEFAULT_NAMES[id];
  el.addEventListener('change', () => { store.set(id, el.value); refreshWpOptions(); refresh(); });
}
const nameList = (type) => [...new Set($('#' + NAMED[type]).value.split(/[,\n]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
function wpChoices(type) {
  if (NAMED[type]) return nameList(type);
  const n = Math.max(30, (state.rows.length || 0) + 10);
  return Array.from({ length: n }, (_, i) => String(i + 1));
}
const wpLabel = (r) => (r.wpType === 'APT' ? r.wpVal : r.wpType && r.wpVal ? `${r.wpType} ${r.wpVal}` : '');
function usedBy(type, exceptIdx) {
  return new Set(state.rows.filter((r, j) => j !== exceptIdx && r.wpType === type && r.wpVal).map((r) => r.wpVal));
}
function refreshWpOptions() {
  state.rows.forEach((r, i) => {
    const sel = $(`#wp-${i} [data-k=wpVal]`);
    if (!sel) return;
    if (!r.wpType) { sel.innerHTML = '<option value="">–</option>'; sel.disabled = true; return; }
    if (r.wpType === 'APT') { sel.innerHTML = `<option>${esc(r.wpVal)}</option>`; sel.disabled = true; return; }
    sel.disabled = false;
    const used = usedBy(r.wpType, i);
    let opts = wpChoices(r.wpType).filter((v) => !used.has(v));
    if (r.wpVal && !opts.includes(r.wpVal)) opts = [r.wpVal, ...opts];
    sel.innerHTML = `<option value="">${NAMED[r.wpType] ? 'Name' : '#'}</option>` +
      (opts.length ? opts.map((v) => `<option${v === r.wpVal ? ' selected' : ''}>${esc(v)}</option>`).join('')
        : '<option value="" disabled>None left, add names in Card options</option>');
  });
}

/* ---------- upload: NavLog (required) + Mobile NavLog (optional), any order ---------- */
const drop = $('#drop');
const fileInput = $('#navlog-file');
fileInput.addEventListener('change', () => { loadFiles([...fileInput.files]); fileInput.value = ''; });
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (ev) => loadFiles([...ev.dataTransfer.files]));

async function firstLineText(data) {
  const pdf = await pdfjsLib.getDocument({ data: data.slice(0), isEvalSupported: false }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  return tc.items.slice(0, 5).map((i) => i.str).join(' ');
}

async function loadFiles(files) {
  const err = $('#parse-error');
  err.hidden = true;
  const errors = [];
  let gotNav = false;
  for (const file of files) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      if (isMobileNavlogText(await firstLineText(data))) {
        state.mobile = await parseMobileNavlog(pdfjsLib, data);
        state.mobileName = file.name;
      } else {
        state.navBase = await parseNavlog(pdfjsLib, data);
        state.navName = file.name;
        gotNav = true;
      }
    } catch (e) {
      console.error(e);
      errors.push(`${file.name}: ${e.message || e}`);
    }
  }
  if (errors.length) { err.textContent = `Couldn't read ${errors.join('; ')}`; err.hidden = false; }
  if (gotNav) startFromNavlog();
  applyMobile();
  renderFileStatus();
  if (state.nav) { renderSummary(); renderWaypoints(); refresh(); }
}

function startFromNavlog() {
  const nav = state.navBase;
  state.routeEdited = false;
  if (nav.flightRules) { state.rules = nav.flightRules; state.rulesAuto = true; } else state.rulesAuto = false;
  state.rows = nav.waypoints.map((w) => {
    const apt = isAirport(w.name);
    const r = { wpType: apt ? 'APT' : '', wpVal: apt ? w.name.toUpperCase() : '', dtd: '', tca: '', ias: $('#iasAll').value || '', remarks: '', mgrs: '', mgrsSrc: '' };
    r.wp = wpLabel(r);
    return r;
  });
  if (!$('#operation').value && nav.callsign) $('#operation').placeholder = `e.g. ${nav.callsign}`;
  ['#step-mission', '#step-wps', '#step-build'].forEach((s) => ($(s).hidden = false));
  $('#download').hidden = true;
  $('#preview').innerHTML = '';
  $('#build-msg').hidden = true;
}

// Merge Mobile NavLog data (exact MGRS, leg seconds) into the working NavLog
function applyMobile() {
  state.mobileError = '';
  if (!state.navBase) { state.nav = null; return; }
  const base = state.navBase;
  state.nav = { ...base, hasMobile: false, waypoints: base.waypoints.map((w) => ({ ...w, legSec: null })) };
  if (!state.mobile) return;
  const pair = pairWithNavlog(base, state.mobile);
  if (!pair.ok) { state.mobileError = pair.error; return; }
  state.nav.hasMobile = true;
  pair.points.forEach((p, i) => {
    Object.assign(state.nav.waypoints[i], { legSec: p.legSec, totSec: p.totSec, totExact: p.totExact });
    const r = state.rows[i];
    if (r && p.mgrs && (!r.mgrs || r.mgrsSrc === 'mobile')) { r.mgrs = p.mgrs; r.mgrsSrc = 'mobile'; }
  });
}

function renderFileStatus() {
  const el = $('#file-status');
  const nav = state.navName
    ? `<li class="ok">NavLog: <b>${esc(state.navName)}</b></li>`
    : '<li class="need">NavLog: not loaded (required)</li>';
  let mob;
  if (!state.mobileName) mob = '<li class="opt">Mobile NavLog: not loaded (optional; adds exact MGRS grids and leg times to the second)</li>';
  else if (state.mobileError) mob = `<li class="need">Mobile NavLog: <b>${esc(state.mobileName)}</b>. ${esc(state.mobileError)}</li>`;
  else if (!state.navBase) mob = `<li class="ok">Mobile NavLog: <b>${esc(state.mobileName)}</b> (waiting for the NavLog)</li>`;
  else mob = `<li class="ok">Mobile NavLog: <b>${esc(state.mobileName)}</b>. MGRS and leg times applied</li>`;
  el.innerHTML = nav + mob;
  el.hidden = false;
}

function renderSummary() {
  const n = state.nav;
  const el = $('#nav-summary');
  el.innerHTML = `
    <div class="ttl">${esc(n.title)}</div>
    <div class="chips">
      <span class="chip">Points <b>${n.waypoints.length}</b></span>
      <span class="chip">ETE <b>${esc(fmtTime(n.totalEteMin))}</b></span>
      <span class="chip">Distance <b>${esc(n.totalDistanceNm)} NM</b></span>
      <span class="chip">Flight fuel <b>${esc(n.flightFuel)} ${esc(n.flightFuelUnits)}</b></span>
      ${n.flightRules ? `<span class="chip">Filed <b>${n.flightRules}</b></span>` : ''}
      ${n.hasMobile ? '' : '<span class="chip" style="background:var(--warn-bg);color:var(--warn)">Leg times to the minute only</span>'}
    </div>`;
  el.hidden = false;
}

/* ---------- mission inputs ---------- */
for (const b of $$('.seg button')) {
  b.addEventListener('click', () => { state.rules = b.dataset.rules; state.rulesAuto = false; refresh(); });
}
for (const id of ['operation', 'aircraftFuel', 'burn', 'altFuel', 'footerRoute', 'footerV']) {
  $('#' + id).addEventListener('input', refresh);
}
$('#routeText').addEventListener('input', () => { state.routeEdited = true; refresh(); });
$('#route-reset').addEventListener('click', () => { state.routeEdited = false; refresh(); });
$('#ias-apply').addEventListener('click', () => {
  const v = $('#iasAll').value;
  store.set('iasAll', v);
  state.rows.forEach((r, i) => { r.ias = v; const el = $(`#wp-${i} [data-k=ias]`); if (el) el.value = v; });
  refresh();
});

function inputs() {
  return {
    operation: $('#operation').value.trim(),
    aircraftFuel: $('#aircraftFuel').value,
    burn: $('#burn').value,
    altFuel: $('#altFuel').value,
    rules: state.rules,
    routeText: state.routeEdited ? $('#routeText').value : undefined,
    footerRoute: $('#footerRoute').value.trim(),
    footerV: $('#footerV').value.trim(),
  };
}

/* ---------- waypoint cards ---------- */
function renderWaypoints() {
  const list = $('#wp-list');
  list.innerHTML = state.nav.waypoints.map((w, i) => {
    const last = i === state.nav.waypoints.length - 1;
    const role = i === 0 ? 'Departure' : last ? 'Destination' : `Leg ${i}`;
    const r = state.rows[i];
    return `
    <div class="wp" id="wp-${i}">
      <div class="wp-head">
        <div><span class="wp-idx">${role}</span><span class="wp-name">${esc(w.name)}</span>${w.mergedFrom ? `<span class="wp-idx" style="margin-left:8px">leg includes ${esc(w.mergedFrom.join(', '))}</span>` : ''}</div>
        <span class="badge" data-badge></span>
      </div>
      <div class="wp-auto">
        <div><span>MC</span><b data-o="mc"></b></div>
        <div><span>ALT</span><b data-o="alt"></b></div>
        <div><span>ETE</span><b data-o="ete"></b></div>
        <div><span>ELAPSED</span><b data-o="elapsed"></b></div>
        <div><span>LEG DIST</span><b data-o="legDist"></b></div>
        <div><span>REM</span><b data-o="rem"></b></div>
        <div><span>GS</span><b data-o="gs"></b></div>
        <div><span>MIN FUEL</span><b data-o="minFuel"></b></div>
        <div><span>TANK FUEL</span><b data-o="tank"></b></div>
      </div>
      <div class="wp-in">
        <label class="f wpf">WP<span class="wpsel">
          <select data-k="wpType" aria-label="Point type"><option value="">Type</option>${isAirport(w.name) ? `<option value="APT"${r.wpType === 'APT' ? ' selected' : ''}>Airport</option>` : ''}${WP_TYPES.map((t) => `<option${t === r.wpType ? ' selected' : ''}>${t}</option>`).join('')}</select>
          <select data-k="wpVal" aria-label="Point number or name"></select></span></label>
        <label class="f">DTD ID<input type="text" data-k="dtd" value="${esc(r.dtd)}" autocomplete="off"></label>
        <label class="f"><span class="lbl">IAS <small>kt</small></span><input type="number" inputmode="numeric" data-k="ias" data-req value="${esc(r.ias)}"></label>
        <label class="f"><span class="lbl">TCA <small>optional</small></span><input type="text" data-k="tca" value="${esc(r.tca)}" autocomplete="off"></label>
        <label class="f mg"><span class="lbl">MGRS GRID <small>NavLog: ${esc(w.name)}</small></span><input type="text" data-k="mgrs" data-req value="${esc(r.mgrs)}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="13S EC 1234 5678"><span class="ll" data-o="latlong"></span></label>
        <label class="f rem">Description / remarks<input type="text" data-k="remarks" value="${esc(r.remarks)}" autocomplete="off"></label>
      </div>
    </div>`;
  }).join('');

  $$('.wp', list).forEach((card, i) => {
    for (const inp of $$('input[data-k]', card)) {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        state.rows[i][k] = inp.value;
        if (k === 'mgrs') state.rows[i].mgrsSrc = 'user';
        refresh();
      });
      if (inp.dataset.k === 'mgrs') {
        inp.addEventListener('blur', () => {
          const p = prettyMgrs(inp.value);
          if (p !== inp.value) { inp.value = p; state.rows[i].mgrs = p; refresh(); }
        });
      }
    }
    const typeSel = $('[data-k=wpType]', card);
    const valSel = $('[data-k=wpVal]', card);
    typeSel.addEventListener('change', () => {
      const r = state.rows[i];
      r.wpType = typeSel.value;
      const used = usedBy(r.wpType, i);
      r.wpVal = r.wpType === 'APT' ? state.nav.waypoints[i].name.toUpperCase()
        : r.wpType ? (wpChoices(r.wpType).find((v) => !used.has(v)) || '') : '';
      r.wp = wpLabel(r);
      refreshWpOptions();
      refresh();
    });
    valSel.addEventListener('change', () => {
      const r = state.rows[i];
      r.wpVal = valSel.value;
      r.wp = wpLabel(r);
      refreshWpOptions();
      refresh();
    });
  });
  refreshWpOptions();
}

/* ---------- live recompute ---------- */
function refresh() {
  if (!state.nav) return;
  const inp = inputs();
  const card = computeCard(state.nav, inp, state.rows);

  // flight rules buttons
  for (const b of $$('.seg button')) b.setAttribute('aria-checked', String(b.dataset.rules === state.rules));
  $('#rules-src').textContent = state.rulesAuto ? '(from NavLog)' : '';

  // fuel panel
  const resMin = reserveMinutes(state.rules);
  const dash = (v) => (v === '' || v == null ? '—' : v);
  $('#fuel-calc').innerHTML = `
    <div class="k"><span>Aircraft fuel</span><b>${dash(card.aircraftFuel)}</b></div>
    <div class="k"><span>Req</span><b>${dash(card.req)}</b></div>
    <div class="k"><span>Burn</span><b>${dash(card.burn)}</b></div>
    <div class="k"><span>Reserve ${resMin} min</span><b>${dash(card.reserve)}</b></div>
    <div class="k bingo"><span>Bingo</span><b>${dash(card.bingo)}</b></div>
    <div class="formula">BINGO = REQ ${dash(card.req)} + ALTERNATE ${dash(inp.altFuel || 0)} + RESERVE (${dash(card.burn)} lbs/hr x ${resMin} min = ${dash(card.reserve)})</div>`;

  // route text
  if (!state.routeEdited) $('#routeText').value = card.route;

  // waypoint auto values
  card.waypoints.forEach((w, i) => {
    const el = $(`#wp-${i}`);
    if (!el) return;
    for (const o of $$('[data-o]', el)) {
      const v = w[o.dataset.o];
      o.textContent = v === '' ? (o.dataset.o === 'latlong' ? '' : '–') : v;
    }
    const mgEl = $('[data-k=mgrs]', el);
    const valid = !!mgrsToLatLon(state.rows[i].mgrs);
    mgEl.classList.toggle('bad', !!state.rows[i].mgrs && !valid);
    if (state.rows[i].mgrs && !valid) $('[data-o=latlong]', el).textContent = 'Not a valid MGRS grid';
    const badge = $('[data-badge]', el);
    if (valid && state.rows[i].mgrsSrc === 'mobile') { badge.className = 'badge auto'; badge.textContent = 'MGRS from Mobile NavLog'; }
    else if (valid) { badge.className = 'badge edit'; badge.textContent = 'MGRS entered'; }
    else if (state.rows[i].mgrs) { badge.className = 'badge need'; badge.textContent = 'MGRS not valid'; }
    else { badge.className = 'badge need'; badge.textContent = 'Enter MGRS'; }
  });

  // missing-field prompts
  const missing = [];
  const mark = (el, isMissing) => el && el.classList.toggle('missing', isMissing);
  const req = [['operation', 'Operation'], ['aircraftFuel', 'Aircraft fuel'], ['burn', 'Burn'], ['altFuel', 'Fuel to alternate']];
  for (const [id, label] of req) {
    const el = $('#' + id);
    const m = el.value.trim() === '';
    mark(el, m);
    if (m) missing.push(label);
  }
  const rowMissing = { wp: [], ias: [], mgrs: [] };
  state.rows.forEach((r, i) => {
    for (const k of Object.keys(rowMissing)) {
      const el = $(`#wp-${i} [data-k=${k === 'wp' ? (r.wpType ? 'wpVal' : 'wpType') : k}]`);
      const bad = k === 'mgrs' ? !mgrsToLatLon(r.mgrs) : String(r[k] || '').trim() === '';
      if (k === 'wp') { $(`#wp-${i} [data-k=wpType]`)?.classList.remove('missing'); $(`#wp-${i} [data-k=wpVal]`)?.classList.remove('missing'); }
      mark(el, bad && !(k === 'mgrs' && r.mgrs));
      if (bad) rowMissing[k].push(i + 1);
    }
  });
  const names = { wp: 'WP', ias: 'IAS' };
  for (const k of ['wp', 'ias']) {
    if (rowMissing[k].length) missing.push(`${names[k]} for point ${rowMissing[k].join(', ')}`);
  }
  const box = $('#missing');
  if (missing.length) {
    box.innerHTML = `Still blank (you can build anyway and hand-write them):<ul>${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
    box.hidden = false;
  } else box.hidden = true;

  // MGRS is mandatory: no build until every grid is valid
  const gridsLeft = rowMissing.mgrs;
  state.gridsOk = gridsLeft.length === 0;
  const blk = $('#build-block');
  if (!state.building) $('#build').disabled = !state.gridsOk;
  if (gridsLeft.length) {
    blk.textContent = `Enter a valid MGRS grid for every point before building. Missing or invalid: point ${gridsLeft.join(', ')}.`;
    blk.hidden = false;
  } else blk.hidden = true;

  state.card = card;
}

/* ---------- build ---------- */
$('#build').addEventListener('click', async () => {
  const btn = $('#build');
  refresh();
  if (!state.gridsOk) return;
  state.building = true;
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    refresh();
    if (!state.templateBytes) {
      const res = await fetch(new URL('../assets/da7916-blank.pdf', import.meta.url));
      if (!res.ok) throw new Error('Could not load the blank DA 7916 template');
      state.templateBytes = new Uint8Array(await res.arrayBuffer());
    }
    const out = await build7916(PDFLib, state.templateBytes, state.card, { flatten: $('#flatten').checked });
    const blob = new Blob([out.bytes], { type: 'application/pdf' });
    if (state.lastUrl) URL.revokeObjectURL(state.lastUrl);
    state.lastUrl = URL.createObjectURL(blob);
    const a = $('#download');
    const op = (state.card.operation || 'TDH').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'TDH';
    a.href = state.lastUrl;
    a.download = `DA7916_${op}.pdf`;
    a.hidden = false;
    const msg = $('#build-msg');
    msg.textContent = `${out.pages} page${out.pages > 1 ? 's' : ''}` +
      (out.flattened && !$('#flatten').checked ? '. Over 22 waypoints, so continuation pages were added and the fields are locked.' : '.');
    msg.hidden = false;
    await renderPreview(out.bytes);
  } catch (e) {
    console.error(e);
    const msg = $('#build-msg');
    msg.textContent = `Build failed: ${e.message || e}`;
    msg.hidden = false;
  } finally {
    state.building = false;
    btn.textContent = 'Build DA 7916';
    refresh();
  }
});

async function renderPreview(bytes) {
  const wrap = $('#preview');
  wrap.innerHTML = '';
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    wrap.appendChild(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE }).promise;
  }
}
