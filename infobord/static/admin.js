'use strict';
/* Infobord – beheerscherm */

let CFG = null;
let dirty = false;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) { location.href = '/login?next=/admin'; throw new Error('Niet ingelogd'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
}
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach((k) => (a = a[k] ??= {})); a[ks.at(-1)] = v; }
const markDirty = () => { dirty = true; $('#save').textContent = 'Opslaan •'; };
const uid = () => Math.random().toString(16).slice(2, 10);

/* ---------- velden met data-path ---------- */
function bindPaths() {
  $$('[data-path]').forEach((inp) => {
    const v = getPath(CFG, inp.dataset.path);
    if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v ?? '';
    inp.oninput = inp.onchange = () => {
      let val = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (inp.type === 'number') val = inp.value === '' ? null : Number(inp.value);
      setPath(CFG, inp.dataset.path, val); markDirty();
    };
  });
  $$('[data-img-path]').forEach((box) => {
    box.replaceChildren(imageField(getPath(CFG, box.dataset.imgPath), (v) => setPath(CFG, box.dataset.imgPath, v)));
  });
}

function imageField(value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'img-field';
  wrap.innerHTML = `<img alt="" ${value ? '' : 'hidden'}><input type="text" placeholder="/uploads/... of https://..."><label class="btn small">Uploaden<input type="file" accept="image/*" hidden></label>`;
  const img = $('img', wrap), txt = $('input[type=text]', wrap), file = $('input[type=file]', wrap);
  const set = (v) => { txt.value = v || ''; img.src = v || ''; img.hidden = !v; onChange(v); markDirty(); };
  txt.value = value || ''; if (value) img.src = value;
  txt.oninput = () => set(txt.value.trim());
  file.onchange = async () => {
    if (!file.files[0]) return;
    const fd = new FormData(); fd.append('file', file.files[0]);
    const r = await fetch('/api/admin/upload', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) return toast(j.error || 'Upload mislukt', true);
    set(j.url); toast('Afbeelding geüpload');
  };
  return wrap;
}

/* ---------- slides ---------- */
const COMMON = [['duration', 'Tijd (sec)', 'number'], ['from', 'Tonen vanaf', 'date'], ['until', 'Tonen tot en met', 'date']];
const TYPES = {
  text: { label: 'Tekst / mededeling', fields: [['title', 'Titel', 'text'], ['theme', 'Stijl', 'select:light=Licht|dark=Donker|accent=Accentkleur'],
    ['body', 'Tekst — **vet**, *schuin*, regels met “- ” worden een opsomming', 'textarea'], ['image', 'Afbeelding (optioneel)', 'image']] },
  image: { label: 'Afbeelding / poster', fields: [['image', 'Afbeelding', 'image'], ['caption', 'Onderschrift', 'text'],
    ['fit', 'Weergave', 'select:contain=Hele afbeelding|cover=Scherm vullen']] },
  jaarplanning: { label: 'Jaarplanning', fields: [['title', 'Titel', 'text'], ['count', 'Aantal activiteiten', 'number']] },
  verhuur: { label: 'Verhuur (kalender)', fields: [['title', 'Titel', 'text'], ['weeks', 'Aantal weken', 'number']] },
  weather: { label: 'Weersverwachting', fields: [['title', 'Titel', 'text']] },
  countdown: { label: 'Aftellen naar…', fields: [['title', 'Titel (bijv. Zomerkamp 2027)', 'text'], ['target', 'Datum', 'date'],
    ['text', 'Tekst', 'textarea'], ['image', 'Afbeelding (optioneel)', 'image']] },
  qr: { label: 'QR-code', fields: [['title', 'Titel', 'text'], ['url', 'Link in de QR-code', 'text'], ['text', 'Tekst', 'textarea']] },
  fbposts: { label: 'Facebook-posts (nieuwste)', fields: [['layout', 'Weergave', 'select:list=Overzicht: meerdere posts op één slide|single=Eén post per slide'],
    ['title', 'Titel', 'text'], ['count', 'Aantal posts (overzicht: max. 5)', 'number'],
    ['max_age_days', 'Alleen posts van de laatste … dagen (0 = alles)', 'number']],
    note: 'Bij “Eén post per slide” geldt de tijd per post. Kies onder Bronnen of de posts via de website of via een token komen.' },
  facebook: { label: 'Facebook-tijdlijn (plugin)', fields: [['title', 'Titel', 'text'], ['url', 'Adres Facebook-pagina', 'text'],
    ['compact', 'Weergave', 'select:true=Compact (meer posts zichtbaar)|false=Met omslagfoto'], ['text', 'Tekst', 'textarea']] },
  web: { label: 'Webpagina', fields: [['title', 'Naam (alleen voor beheer)', 'text'], ['url', 'Adres (moet inbedden toestaan)', 'text'], ['zoom', 'Zoom %', 'number']] },
};
const DEFAULTS = { fbposts: { layout: 'list', title: 'Nieuws van Facebook', count: 4, max_age_days: 60, duration: 20 }, facebook: { compact: true },
  text: { theme: 'light' }, jaarplanning: { count: 8, title: 'Komende activiteiten' }, verhuur: { weeks: 4, title: 'Bezetting gebouwen' },
  weather: { title: 'Weersverwachting' }, web: { zoom: 100 }, image: { fit: 'contain' } };

function field(obj, [key, label, kind]) {
  const lab = document.createElement('label');
  if (kind === 'textarea' || kind === 'image') lab.className = 'wide';
  lab.textContent = label;
  let inp;
  if (kind === 'textarea') inp = document.createElement('textarea');
  else if (kind === 'image') { lab.append(imageField(obj[key], (v) => (obj[key] = v))); return lab; }
  else if (kind.startsWith('select:')) {
    inp = document.createElement('select');
    kind.slice(7).split('|').forEach((o) => { const [v, t] = o.split('='); inp.add(new Option(t, v)); });
  } else { inp = document.createElement('input'); inp.type = kind; }
  inp.value = obj[key] ?? '';
  if (inp.tagName === 'SELECT' && inp.selectedIndex < 0) inp.selectedIndex = 0; // standaard = eerste optie
  inp.oninput = inp.onchange = () => {
    let v = kind === 'number' ? Number(inp.value) : inp.value;
    if (v === 'true' || v === 'false') v = v === 'true';
    obj[key] = v; markDirty(); if (key === 'title') renderSlideNames();
  };
  lab.append(inp);
  return lab;
}

function renderSlideNames() {
  $$('#slide-list .card').forEach((c, i) => { $('.name', c).textContent = CFG.slides[i]?.title || '(zonder titel)'; });
}

function renderSlides() {
  const list = $('#slide-list');
  list.innerHTML = '';
  CFG.slides.forEach((s, i) => {
    const t = TYPES[s.type] || { label: s.type, fields: [] };
    const card = document.createElement('div');
    card.className = `card ${s.enabled === false ? 'off' : ''}`;
    card.innerHTML = `<div class="card-head"><span class="type">${esc(t.label)}</span><span class="name"></span>
      <label class="check"><input type="checkbox" ${s.enabled !== false ? 'checked' : ''}> Actief</label>
      <button class="btn small" data-a="up" title="Omhoog">↑</button><button class="btn small" data-a="down" title="Omlaag">↓</button>
      <button class="btn small" data-a="dup" title="Kopiëren">⧉</button><button class="btn small danger" data-a="del">Verwijderen</button></div>
      <div class="form"></div>`;
    $('.name', card).textContent = s.title || '(zonder titel)';
    const form = $('.form', card);
    if (t.note) form.insertAdjacentHTML('beforebegin', `<p class="hint">${esc(t.note)}</p>`);
    [...t.fields, ...COMMON].forEach((f) => form.append(field(s, f)));
    $('input[type=checkbox]', card).onchange = (e) => { s.enabled = e.target.checked; card.classList.toggle('off', !s.enabled); markDirty(); };
    card.onclick = (e) => {
      const a = e.target.dataset?.a; if (!a) return;
      if (a === 'up' && i > 0) [CFG.slides[i - 1], CFG.slides[i]] = [CFG.slides[i], CFG.slides[i - 1]];
      else if (a === 'down' && i < CFG.slides.length - 1) [CFG.slides[i + 1], CFG.slides[i]] = [CFG.slides[i], CFG.slides[i + 1]];
      else if (a === 'dup') CFG.slides.splice(i + 1, 0, { ...structuredClone(s), id: uid(), title: (s.title || '') + ' (kopie)' });
      else if (a === 'del') { if (!confirm(`Slide “${s.title || t.label}” verwijderen?`)) return; CFG.slides.splice(i, 1); }
      else return;
      markDirty(); renderSlides();
    };
    list.append(card);
  });
}

/* ---------- jaarplanning ---------- */
function renderPlanning() {
  const today = new Date().toISOString().slice(0, 10);
  const tb = $('#jp-table tbody');
  tb.innerHTML = '';
  CFG.jaarplanning.forEach((it, i) => {
    const tr = document.createElement('tr');
    if ((it.end || it.date) < today) tr.className = 'past';
    tr.innerHTML = `<td><input type="date" data-k="date"></td><td><input type="date" data-k="end"></td>
      <td><input data-k="title"></td><td><input data-k="group"></td><td><button class="btn small danger">✕</button></td>`;
    $$('input', tr).forEach((inp) => { inp.value = it[inp.dataset.k] || ''; inp.oninput = () => { it[inp.dataset.k] = inp.value; markDirty(); }; });
    $('button', tr).onclick = () => { CFG.jaarplanning.splice(i, 1); markDirty(); renderPlanning(); };
    tb.append(tr);
  });
  if (!CFG.jaarplanning.length) tb.innerHTML = '<tr><td colspan="5" class="hint" style="padding:1rem">Nog geen activiteiten. Importeer de PDF of voeg ze handmatig toe.</td></tr>';
}

/* ---------- gebouwen ---------- */
function renderBuildings() {
  const box = $('#bld-list');
  box.innerHTML = '';
  CFG.sources.verhuur.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'card';
    row.innerHTML = `<div class="row" style="margin:0"><input placeholder="Naam" data-k="name" style="max-width:14rem"><input placeholder="https://.../boekingspagina/" data-k="url">
      <button class="btn small" data-a="test">Test</button><button class="btn small danger" data-a="del">✕</button></div><div class="out"></div>`;
    $$('input', row).forEach((inp) => { inp.value = b[inp.dataset.k] || ''; inp.oninput = () => { b[inp.dataset.k] = inp.value; markDirty(); }; });
    row.onclick = async (e) => {
      if (e.target.dataset.a === 'del') { CFG.sources.verhuur.splice(i, 1); markDirty(); renderBuildings(); }
      if (e.target.dataset.a === 'test') {
        const out = $('.out', row); out.innerHTML = '<p class="hint">Bezig…</p>';
        try {
          const j = await api('/api/admin/test-verhuur', { method: 'POST', body: JSON.stringify({ url: b.url }) });
          const d = j.diagnostics[0] || {};
          out.innerHTML = `<p class="ok">${d.cells} kalenderdagen gevonden, ${Object.keys(j.booked).length} geboekt deze maand.</p><pre>${esc(JSON.stringify(j, null, 2))}</pre>`;
        } catch (err) { out.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
      }
    };
    box.append(row);
  });
}

/* ---------- status ---------- */
const NAMES = { weather: 'Weer (Open-Meteo / MeteoAlarm)', verhuur: 'Verhuuragenda', stook: 'Natuurbrandrisico', facebook: 'Facebook-posts' };
async function renderStatus() {
  const st = await api('/api/admin/status');
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('nl-NL') : '—');
  $('#status').innerHTML = Object.entries(st).map(([k, v]) => `
    <div class="st-item"><h4>${NAMES[k] || k}</h4>
      <div>Laatst bijgewerkt: <b>${fmt(v.updated)}</b> ${v.summary ? '· ' + esc(v.summary) : ''}</div>
      ${v.error ? `<div class="err">Laatste fout (${fmt(v.error_time)}): ${esc(v.error)}</div>` : '<div class="ok">Geen fouten</div>'}
      ${v.buildings ? v.buildings.map((b) => `<div>${esc(b.name)}: ${b.booked_days} geboekte dagen
        <details><summary class="hint">Details</summary><pre>${esc(JSON.stringify(b.diagnostics, null, 2))}</pre></details></div>`).join('') : ''}
    </div>`).join('');
}

/* ---------- init ---------- */
async function load() {
  CFG = await api('/api/admin/config');
  bindPaths(); renderSlides(); renderPlanning(); renderBuildings();
  dirty = false; $('#save').textContent = 'Opslaan';
}

$('#save').onclick = async () => {
  try {
    CFG.jaarplanning = CFG.jaarplanning.filter((i) => i.date && i.title);
    await api('/api/admin/config', { method: 'POST', body: JSON.stringify(CFG) });
    await load();
    toast('Opgeslagen — het scherm werkt binnen ~20 seconden bij');
  } catch (e) { toast(e.message, true); }
};

$('#tabs').onclick = (e) => {
  const tab = e.target.dataset.tab; if (!tab) return;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b === e.target));
  $$('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === tab));
  if (tab === 'status') renderStatus().catch((err) => toast(err.message, true));
};

Object.entries(TYPES).forEach(([k, t]) => $('#new-type').add(new Option(t.label, k)));
$('#add-slide').onclick = () => {
  const type = $('#new-type').value;
  CFG.slides.unshift({ id: uid(), type, enabled: true, duration: 15, title: '', from: '', until: '', ...(DEFAULTS[type] || {}) });
  markDirty(); renderSlides(); toast('Slide bovenaan toegevoegd — vergeet niet op te slaan');
};
$('#jp-add').onclick = () => { CFG.jaarplanning.unshift({ date: '', end: '', title: '', group: '' }); markDirty(); renderPlanning(); };
$('#jp-import').onclick = async () => {
  const btn = $('#jp-import'); btn.disabled = true; btn.textContent = 'Bezig…';
  try {
    const j = await api('/api/admin/import-jaarplanning', { method: 'POST', body: JSON.stringify({ url: CFG.sources.jaarplanning_pdf }) });
    const replace = !CFG.jaarplanning.length || confirm(`${j.items.length} activiteiten gevonden.\n\nOK = huidige lijst vervangen\nAnnuleren = toevoegen aan huidige lijst`);
    CFG.jaarplanning = (replace ? j.items : [...CFG.jaarplanning, ...j.items]).sort((a, b) => a.date.localeCompare(b.date));
    markDirty(); renderPlanning(); toast('Geïmporteerd — controleer de datums en klik Opslaan');
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = 'Importeer uit PDF';
};
$('#bld-add').onclick = () => { CFG.sources.verhuur.push({ name: '', url: '' }); markDirty(); renderBuildings(); };
$('#refresh').onclick = async () => { await api('/api/admin/refresh', { method: 'POST' }); toast('Verversen gestart'); setTimeout(() => renderStatus(), 6000); };
$('#stook-test').onclick = async () => {
  $('#stook-result').textContent = 'Bezig…';
  try { const j = await api('/api/admin/test-stook', { method: 'POST', body: '{}' }); $('#stook-result').textContent = `${j.title} – ${j.region}`; }
  catch (e) { $('#stook-result').textContent = e.message; }
};
$('#pw-save').onclick = async () => {
  try { await api('/api/admin/password', { method: 'POST', body: JSON.stringify({ password: $('#pw1').value }) }); $('#pw1').value = ''; toast('Wachtwoord ingesteld'); $('.banner')?.remove(); }
  catch (e) { toast(e.message, true); }
};
$('#fb-connect-btn').onclick = async () => {
  const out = $('#fb-pages'); out.innerHTML = '<p class="hint">Bezig…</p>';
  try {
    const j = await api('/api/admin/facebook-connect', { method: 'POST', body: JSON.stringify({
      app_id: $('#fb-app-id').value, app_secret: $('#fb-app-secret').value, user_token: $('#fb-user-token').value,
      page_id: $('#fb-page-hint').value || $('#fb-page-hint').placeholder }) });
    out.innerHTML = '<p>Kies de pagina:</p>';
    j.pages.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'btn'; b.style.marginRight = '.5rem'; b.textContent = `${p.name} (${p.id})`;
      b.onclick = () => {
        CFG.sources.facebook_page_id = p.id; CFG.sources.facebook_token = p.token;
        bindPaths(); markDirty();
        $('#fb-app-secret').value = ''; $('#fb-user-token').value = '';
        out.innerHTML = `<p class="ok">Gekoppeld aan “${esc(p.name)}”. Klik nu op <b>Opslaan</b>.</p>`;
      };
      out.append(b);
    });
  } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
};
$('#fb-test').onclick = async () => {
  const out = $('#fb-result'); out.innerHTML = '<p class="hint">Bezig…</p>';
  const src = CFG.sources;
  try {
    const j = await api('/api/admin/test-facebook', { method: 'POST', body: JSON.stringify({
      facebook_method: src.facebook_method, facebook_web_url: src.facebook_web_url,
      facebook_page_id: src.facebook_page_id, facebook_token: src.facebook_token, facebook_graph_version: src.facebook_graph_version }) });
    const rows = j.posts.map((p) => `<li><b>${esc(p.label || new Date(p.created).toLocaleDateString('nl-NL'))}</b> — ${esc(p.text)}${p.image ? ' 🖼' : ''}</li>`).join('');
    out.innerHTML = `<p class="ok">${esc(j.page || 'Pagina')}: ${j.posts.length} posts gevonden via ${j.source === 'web' ? 'de website' : 'de token'}.</p>
      ${j.warning ? `<p class="err">${esc(j.warning)}</p>` : ''}<ul>${rows}</ul>`;
  } catch (e) { out.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
};
$('#upd-check').onclick = async () => {
  const out = $('#upd-result');
  if (dirty) { out.textContent = 'Sla eerst je wijzigingen op.'; return; }
  out.textContent = 'Bezig…';
  const st = await api('/api/admin/update-status').catch((e) => ({ error: e.message }));
  const cur = st.current?.sha ? `${st.current.sha.slice(0, 7)} (${new Date(st.current.date).toLocaleString('nl-NL')})` : 'onbekend';
  if (st.error) { out.innerHTML = `<span class="err">${esc(st.error)}</span>`; $('#upd-now').hidden = true; return; }
  const nw = st.latest;
  out.innerHTML = `Huidige versie: <b>${esc(cur)}</b><br>Nieuwste versie: <b>${esc(nw.sha.slice(0, 7))}</b> — ${esc(nw.message)} (${new Date(nw.date).toLocaleString('nl-NL')})<br>`
    + (st.available ? '<span class="ok">Er is een update beschikbaar.</span>' : '<span class="ok">Je hebt de nieuwste versie.</span>');
  $('#upd-now').hidden = !st.available;
};
$('#upd-now').onclick = async () => {
  if (!confirm('Infobord nu bijwerken en herstarten?')) return;
  const out = $('#upd-result'); out.textContent = 'Bijwerken…';
  try {
    await api('/api/admin/update', { method: 'POST', body: '{}' });
    out.innerHTML = '<span class="ok">Bijgewerkt! Het infobord herstart; deze pagina laadt over een paar seconden opnieuw.</span>';
    setTimeout(() => location.reload(), 12000);
  } catch (e) { out.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
};
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

load().catch((e) => toast(e.message, true));
