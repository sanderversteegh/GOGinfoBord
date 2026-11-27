'use strict';
/* Infobord – scherm. Haalt elke 60 s /api/state op en laat de slides rouleren. */

const POLL_MS = 20 * 1000;
const S = { tz: 'Europe/Amsterdam', boot: null, version: null, day: null, slides: [], idx: -1, timer: null, sig: '' };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const emo = (s) => `<span class="emoji">${s ?? ''}</span>`;

/* ---------- datums ---------- */
const F = (o) => new Intl.DateTimeFormat('nl-NL', { timeZone: S.tz, ...o });
const D = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const fd = (iso, o) => new Intl.DateTimeFormat('nl-NL', { timeZone: 'UTC', ...o }).format(D(iso));
const addDays = (iso, n) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 86400000);
function localISO(date) {
  const p = F({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const todayISO = () => localISO(new Date());
/* "Vandaag", "3 dagen geleden", "2 weken geleden", anders de datum */
function relDay(iso, today) {
  const d = new Date(iso);
  const n = daysBetween(localISO(d), today);
  if (n <= 0) return 'Vandaag';
  if (n === 1) return 'Gisteren';
  if (n < 7) return `${n} dagen geleden`;
  if (n < 14) return '1 week geleden';
  if (n < 35) return `${Math.floor(n / 7)} weken geleden`;
  return F({ day: 'numeric', month: 'long' }).format(d);
}
/* Eerste regel of zin van een post als kop, de rest als tekst */
function splitPost(text) {
  const t = String(text || '').trim();
  const nl = t.indexOf('\n');
  if (nl > 0 && nl <= 120) return { head: t.slice(0, nl).trim(), body: t.slice(nl + 1).trim() };
  const m = t.match(/^(.{15,120}?[.!?])\s+([\s\S]*)$/);
  return m ? { head: m[1], body: m[2] } : { head: '', body: t };
}
const br = (s) => esc(s).replace(/\n{2,}/g, '\n').replace(/\n/g, '<br>');
/* Tekstblokken met data-fit precies zoveel regels geven als er passen (met … aan het eind) */
function fitText(root) {
  root.querySelectorAll('[data-fit]').forEach((el) => {
    // eerst de beschikbare ruimte meten (flex: 1), daarna vastzetten op een heel aantal regels
    el.style.webkitLineClamp = 'unset'; el.style.maxHeight = ''; el.style.flex = '';
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const lines = Math.floor((el.clientHeight + 2) / lh);
    el.style.webkitLineClamp = String(Math.max(1, lines));
    el.style.maxHeight = `${Math.max(1, lines) * lh}px`;
    el.style.flex = 'none';
    el.style.visibility = lines < 1 ? 'hidden' : '';
  });
}
function isoWeek(iso) {
  const d = D(iso); const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3); // donderdag van deze week
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12));
  return Math.ceil((Math.round((d - jan1) / 86400000) + 1) / 7);
}
function ago(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

/* ---------- mini-markdown ---------- */
function md(s) {
  let out = '', list = false;
  for (let line of esc(s).split(/\r?\n/)) {
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    const m = line.match(/^\s*[-•]\s+(.*)$/);
    if (m) { if (!list) { out += '<ul>'; list = true; } out += `<li>${m[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    out += line.trim() === '' ? '<div class="gap"></div>' : `<p>${line}</p>`;
  }
  return out + (list ? '</ul>' : '');
}

/* ---------- klok ---------- */
function tick() {
  const now = new Date();
  const hm = F({ hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const sec = F({ second: '2-digit' }).format(now).padStart(2, '0');
  $('#time').innerHTML = `${hm}<span class="sec">${sec}</span>`;
  const t = todayISO();
  $('#date').innerHTML = `${esc(F({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now))}<span class="wk">week ${isoWeek(t)}</span>`;
  if (S.day && S.day !== t) { S.day = t; poll(); }          // nieuwe dag: data verversen
  if (hm === '04:00' && performance.now() > 5 * 60000) location.reload(); // nachtelijke herstart
}

/* ---------- zijbalk ---------- */
function staleNote(meta, maxMin) {
  const m = ago(meta && meta.updated);
  if (m == null) return '<div class="stale">Nog niet opgehaald</div>';
  if (m > maxMin) return `<div class="stale">Laatst bijgewerkt ${F({ weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(meta.updated))}</div>`;
  return '';
}

function renderWeather(st) {
  const box = $('#weather');
  box.hidden = !st.sidebar.show_weather;
  const w = st.weather;
  if (!w) { box.innerHTML = '<h3>Weer</h3><div class="ag-empty">Nog geen weergegevens</div>'; return; }
  const c = w.current, today = w.daily[0] || {};
  const days = w.daily.slice(1, 5).map((d) => `
    <div class="wx-day"><div>${esc(fd(d.date, { weekday: 'short' }))}</div><div class="i">${emo(d.icon)}</div>
    <b>${Math.round(d.tmax)}°</b> <span class="lo">${Math.round(d.tmin)}°</span></div>`).join('');
  const alerts = (w.alerts || []).slice(0, 2).map((a) =>
    `<div class="wx-alert ${a.level}">⚠ Code ${esc(a.level_nl)}: ${esc(a.event)}</div>`).join('');
  box.innerHTML = `
    <h3>Weer <small>${esc(st.general.subtitle || '')}</small></h3>
    <div class="wx-now">
      <div class="wx-icon">${emo(c.icon)}</div>
      <div><div class="wx-temp">${Math.round(c.temp)}°</div><div class="wx-desc">${esc(c.desc)}</div></div>
      <div class="wx-meta">
        <div>Wind ${c.bft} Bft ${esc(c.wind_dir)}</div>
        <div>Voelt als ${Math.round(c.feels)}°</div>
        <div>Vandaag ${Math.round(today.tmin)}° / ${Math.round(today.tmax)}°</div>
        <div>Zon ${esc(today.sunrise)} – ${esc(today.sunset)}</div>
      </div>
    </div>
    <div class="wx-days">${days}</div>${alerts}${staleNote(st.weather_meta, 90)}`;
}

function renderStook(st) {
  const box = $('#stook');
  box.hidden = !st.sidebar.show_stook;
  const s = st.stook;
  if (!s) { box.className = 'card'; box.innerHTML = '<h3>Stookadvies</h3><div class="ag-empty">Nog geen gegevens</div>'; return; }
  box.className = `card lvl-${s.color}`;
  box.innerHTML = `
    <h3>Natuurbrandrisico <small>${esc(s.region)}</small></h3>
    <div class="stook-row"><span class="stook-dot"></span>
      <div><div class="stook-title">${esc(s.title)}</div><div class="stook-text">${esc(s.text)}</div></div></div>
    ${s.note ? `<div class="stook-note">🔥 ${esc(s.note)}</div>` : ''}`;
}

function renderAgenda(st) {
  const box = $('#agenda');
  box.hidden = !st.sidebar.show_agenda;
  const v = st.verhuur;
  const pills = v.today.map((b) => `
    <div class="ag-pill ${b.busy ? 'busy' : ''}"><div class="n">${esc(b.name)} · vandaag</div>
    <div class="s">${b.busy ? esc(b.label) : 'Vrij'}</div></div>`).join('');
  const items = v.agenda.map((i) => {
    const multi = i.end !== i.start;
    return `<li><div class="ag-date"><span class="ag-dow">${esc(fd(i.start, { weekday: 'short' }))}</span>
      <span class="ag-day">${fd(i.start, { day: 'numeric' })}</span><span class="ag-mon">${esc(fd(i.start, { month: 'short' }))}</span></div>
      <div class="ag-body"><div class="ag-label">${esc(i.label)}</div>
      <div class="ag-bld">${esc(i.building)}${multi ? ` · t/m ${esc(fd(i.end, { weekday: 'short', day: 'numeric', month: 'short' }))}` : ''}</div></div></li>`;
  }).join('');
  box.innerHTML = `<h3>Verhuur gebouwen <small>komende ${st.sidebar.agenda_days} dagen</small></h3>
    <div class="ag-today">${pills}</div>
    <ul class="ag-list">${items || '<li class="ag-empty">Geen boekingen gepland</li>'}</ul>
    ${staleNote(v.meta, 180)}`;
  // Regels die maar half passen verbergen
  requestAnimationFrame(() => {
    const ul = $('.ag-list', box);
    if (ul) for (const li of ul.children) li.style.visibility = li.offsetTop + li.offsetHeight > ul.clientHeight + 1 ? 'hidden' : '';
  });
}

/* ---------- slides ---------- */
function wrap(s, inner, extraCls = '') {
  const el = document.createElement('section');
  el.className = `slide slide-${s.type} theme-${s.theme || 'light'} ${extraCls}`;
  el.innerHTML = inner;
  return el;
}

const RENDER = {
  text(s) {
    const img = s.image ? `<div class="t-img"><img src="${esc(s.image)}" alt=""></div>` : '';
    return wrap(s, `<div class="panel fill"><div class="t-wrap ${img ? 'has-img' : ''}">
      <div style="min-height:0;overflow:hidden">${s.title ? `<div class="s-title">${esc(s.title)}</div>` : ''}
      <div class="t-body">${md(s.body)}</div></div>${img}</div></div>`);
  },
  image(s) {
    if (!s.image) return null;
    return wrap(s, `<div class="img-full"><img src="${esc(s.image)}" alt="" style="object-fit:${s.fit === 'cover' ? 'cover' : 'contain'}"></div>
      ${s.caption ? `<div class="img-cap">${esc(s.caption)}</div>` : ''}`);
  },
  jaarplanning(s, st) {
    const t = st.today;
    const items = (s.items || []).map((i) => {
      const until = i.end && i.end !== i.date ? `t/m ${fd(i.end, { weekday: 'short', day: 'numeric', month: 'short' })}` : '';
      const sub = [i.group, until].filter(Boolean).join(' · ');
      const dim = /geen opkomst/i.test(i.title) ? 'dim' : '';
      const soon = daysBetween(t, i.date) <= 7 && !dim ? 'soon' : '';
      return `<li class="${dim} ${soon}"><div class="jp-date"><div class="jp-dow">${esc(fd(i.date, { weekday: 'short' }))}</div>
        <div class="jp-day">${fd(i.date, { day: 'numeric' })}</div><div class="jp-mon">${esc(fd(i.date, { month: 'short' }))}</div></div>
        <div><div class="jp-title">${esc(i.title)}</div>${sub ? `<div class="jp-sub">${esc(sub)}</div>` : ''}</div></li>`;
    }).join('');
    return wrap(s, `<div class="s-kicker">Jaarplanning</div><div class="s-title">${esc(s.title || 'Komende activiteiten')}</div>
      ${items ? `<ul class="jp-list">${items}</ul>` : '<div class="empty">Nog geen activiteiten ingevoerd</div>'}`);
  },
  verhuur(s, st) {
    if (!s.buildings || !s.buildings.length) return null;
    const head = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((h) => `<div class="cal-head">${h}</div>`).join('');
    const cols = s.buildings.map((b) => {
      let cells = '';
      for (let i = 0; i < s.days; i++) {
        const iso = addDays(s.start, i);
        const lbl = b.booked[iso];
        const dnum = D(iso).getUTCDate();
        const mon = (dnum === 1 || i === 0) ? `<span class="cal-mon">${esc(fd(iso, { month: 'short' }))}</span>` : '';
        const cls = [lbl ? 'booked' : '', iso === st.today ? 'today' : '', iso < st.today ? 'past' : ''].join(' ');
        cells += `<div class="cal-cell ${cls}"><div><span class="cal-num">${dnum}</span>${mon}</div>${lbl ? `<span class="cal-lbl">${esc(lbl)}</span>` : ''}</div>`;
      }
      return `<div class="vh-col"><h2>${esc(b.name)}</h2><div class="cal">${head}${cells}</div></div>`;
    }).join('');
    return wrap(s, `<div class="s-kicker">Verhuur</div><div class="s-title">${esc(s.title || 'Bezetting gebouwen')}</div>
      <div class="vh-cols" style="grid-template-columns:repeat(${s.buildings.length},1fr)">${cols}</div>
      <div class="vh-legend"><span><i style="background:var(--accent)"></i>Geboekt</span>
      <span><i style="background:var(--paper)"></i>Beschikbaar</span>
      <span><i style="box-shadow:inset 0 0 0 3px var(--primary)"></i>Vandaag</span></div>`);
  },
  weather(s, st) {
    const w = st.weather;
    if (!w) return null;
    const hours = w.hourly.filter((_, i) => i % 2 === 0).slice(0, 12).map((h) => `
      <div class="wx-h"><div class="t">${esc(h.time)}</div><div class="i">${emo(h.icon)}</div>
      <div class="c">${Math.round(h.temp)}°</div><div class="p">${h.pop >= 20 ? h.pop + '%' : ''}</div></div>`).join('');
    const days = w.daily.slice(0, 6).map((d, i) => `
      <div class="wx-d"><div class="n">${i === 0 ? 'Vandaag' : esc(fd(d.date, { weekday: 'long' }))}</div>
      <div class="i">${emo(d.icon)}</div><div class="ds">${esc(d.desc)}</div>
      <div class="tt">${Math.round(d.tmax)}° <span>${Math.round(d.tmin)}°</span></div>
      <div class="r">${d.rain > 0.2 ? `${d.rain.toFixed(1)} mm · ${d.pop}%` : 'droog'}</div>
      <div class="muted" style="font-size:.85rem">wind ${d.wind_bft} Bft</div></div>`).join('');
    return wrap(s, `<div class="s-kicker">Weer in ${esc(st.general.subtitle || '')}</div>
      <div class="s-title">${esc(s.title || 'Weersverwachting')}</div>
      <div class="wx-hours">${hours}</div><div class="wx-week">${days}</div>`);
  },
  qr(s) {
    return wrap(s, `<div class="panel fill"><div class="qr-wrap"><div>
      <div class="s-title">${esc(s.title)}</div><div class="qr-text t-body">${md(s.text)}</div>
      <div class="qr-url">${esc((s.url || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div></div>
      <div class="qr-box">${s.qr || ''}</div></div></div>`);
  },
  facebook(s) {
    if (!s.url) return null;
    const compact = s.compact !== false;
    const el = wrap(s, `<div class="fb-wrap"><div class="fb-side"><div class="s-kicker">Socials</div>
      <div class="s-title">${esc(s.title || 'Volg ons op Facebook')}</div><div class="t-body">${md(s.text)}</div>
      ${s.qr ? `<div class="qr-box">${s.qr}</div>` : ''}</div><div class="fb-frame"></div></div>`);
    // Facebook-plugin is max. 500 px breed; we schalen hem op naar de schermhoogte.
    // Compact = kleine kop zonder omslagfoto, zodat er meer posts in beeld passen.
    requestAnimationFrame(() => {
      const box = $('.fb-frame', el); const H = box.clientHeight || 800;
      const h = 1000, k = H / h;
      const src = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(s.url)}&tabs=timeline&width=500&height=${h}&small_header=${compact}&adapt_container_width=true&hide_cover=${compact}&show_facepile=false&locale=nl_NL`;
      box.style.width = `${500 * k}px`;
      box.innerHTML = `<iframe data-refresh src="${src}" data-loaded="${Date.now()}" width="500" height="${h}" scrolling="no" allow="encrypted-media" style="transform:scale(${k})"></iframe>`;
    });
    return el;
  },
  fbpost(s, st) {
    const created = new Date(s.created);
    const when = s.approx ? relDay(s.created, st.today)
      : `${relDay(s.created, st.today)} · ${F({ weekday: 'long', day: 'numeric', month: 'long' }).format(created)}`;
    const img = s.image ? `<div class="fp-img"><div class="fp-bg" style="background-image:url('${esc(s.image)}')"></div><img src="${esc(s.image)}" alt=""></div>` : '';
    return wrap(s, `<div class="fp-wrap ${img ? 'has-img' : 'no-img'}">${img}
      <div class="panel fp-side">
        <div class="s-kicker">${esc(s.kicker)}</div>
        <div class="fp-head">${s.page_picture ? `<img class="fp-avatar" src="${esc(s.page_picture)}" alt="">` : ''}
          <div><div class="fp-page">${esc(s.page)}</div><div class="fp-when">${esc(when)}</div></div></div>
        <div class="fp-text t-body">${md(s.text)}</div>
        ${s.qr ? `<div class="fp-qr"><div class="qr-box">${s.qr}</div><div class="muted">Scan voor de hele post,<br>reacties en meer foto's</div></div>` : ''}
      </div></div>`);
  },
  fbfeed(s, st) {
    const posts = s.posts || [];
    if (!posts.length) return null;
    const [top, ...rest] = posts;
    const pic = (p, cls) => `<div class="${cls}"><div class="fp-bg" style="background-image:url('${esc(p.image)}')"></div><img src="${esc(p.image)}" alt=""></div>`;
    const f = splitPost(top.text);
    const featured = `<article class="ff-feat ${top.image ? '' : 'noimg'}">${top.image ? pic(top, 'ff-img') : ''}
      <div class="ff-body"><div class="ff-when"><span class="ff-new">Nieuwste</span>${esc(relDay(top.created, st.today))}</div>
      ${f.head ? `<h3 class="ff-head">${esc(f.head)}</h3>` : ''}${f.body ? `<p class="ff-text" data-fit>${br(f.body)}</p>` : ''}</div></article>`;
    const items = rest.map((p) => {
      const sp = splitPost(p.text);
      return `<article class="ff-item">${p.image ? pic(p, 'ff-thumb') : '<div class="ff-thumb ff-noimg"><span>“</span></div>'}
        <div class="ff-ibody"><div class="ff-when">${esc(relDay(p.created, st.today))}</div>
        ${sp.head ? `<h4 class="ff-ihead">${esc(sp.head)}</h4>` : ''}${sp.body ? `<p class="ff-itext" data-fit>${br(sp.body)}</p>` : ''}</div></article>`;
    }).join('');
    return wrap(s, `<div class="ff-top"><div><div class="s-kicker">Facebook</div><div class="s-title">${esc(s.title)}</div></div>
      ${s.page_qr ? `<div class="ff-follow"><div><b>${esc(s.page)}</b><br><span class="muted">Scan en volg ons</span></div><div class="qr-box">${s.page_qr}</div></div>` : ''}</div>
      <div class="ff-grid ${rest.length ? '' : 'solo'}">${featured}${rest.length ? `<div class="ff-list">${items}</div>` : ''}</div>`);
  },
  countdown(s, st) {
    if (!s.target) return null;
    const n = daysBetween(st.today, s.target);
    const img = s.image ? `<div class="t-img" style="height:100%"><img src="${esc(s.image)}" alt=""></div>` : '';
    const num = n <= 0 ? '<div class="cd-num">Vandaag!</div>'
      : `<div class="cd-num">${n}</div><div class="cd-unit">${n === 1 ? 'dag' : 'dagen'} te gaan</div>`;
    return wrap(s, `<div class="panel fill"><div class="cd-wrap ${img ? 'has-img' : ''}"><div>
      <div class="s-kicker">Nog even geduld…</div><div class="s-title">${esc(s.title)}</div>${num}
      <div class="cd-text t-body">${md(s.text)}</div>
      <div class="muted" style="font-size:1.1rem;margin-top:.6rem">${esc(fd(s.target, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div>
      </div>${img}</div></div>`);
  },
  web(s) {
    if (!s.url) return null;
    const k = Math.max(25, Math.min(300, Number(s.zoom) || 100)) / 100;
    return wrap(s, `<div class="web-frame"><iframe src="${esc(s.url)}" style="width:${100 / k}%;height:${100 / k}%;transform:scale(${k})"></iframe></div>`);
  },
};

function slideSig(s, st) {
  // Iframes alleen opnieuw opbouwen als hun instellingen wijzigen (voorkomt herladen/flikkeren).
  if (s.type === 'facebook' || s.type === 'web') return JSON.stringify([s.url, s.zoom, s.title, s.text, s.compact]);
  if (s.type === 'weather') return JSON.stringify([s, st.weather]);
  return JSON.stringify([s, st.today]);
}

function buildSlides(st) {
  const host = $('#slides');
  const current = S.slides[S.idx];
  const old = new Map(S.slides.map((x) => [x.id, x]));
  const next = [];
  for (const s of st.slides) {
    const sig = slideSig(s, st);
    const prev = old.get(s.id);
    if (prev && prev.sig === sig) { next.push(prev); old.delete(s.id); continue; }
    let el = null;
    try { el = (RENDER[s.type] || (() => null))(s, st); } catch (e) { console.error('slide', s, e); }
    if (!el) continue;
    if (prev) { if (prev.el.classList.contains('active')) el.classList.add('active'); prev.el.replaceWith(el); old.delete(s.id); }
    else host.appendChild(el);
    fitText(el);
    next.push({ id: s.id, el, sig, duration: Math.max(4, Number(s.duration) || 12) });
  }
  for (const gone of old.values()) gone.el.remove();
  S.slides = next;
  S.idx = current ? next.findIndex((x) => x.id === current.id) : -1;
  if (!next.length) host.innerHTML = '<div class="empty">Nog geen slides — voeg ze toe via /admin</div>';
  else { const e = $('.empty', host); if (e && e.parentElement === host) e.remove(); }
  renderDots();
  if (S.idx === -1) { clearTimeout(S.timer); show(0); }
}

function renderDots() {
  $('#dots').innerHTML = S.slides.length > 1 ? S.slides.map((_, i) => `<span class="${i === S.idx ? 'on' : ''}"></span>`).join('') : '';
}

function show(i) {
  clearTimeout(S.timer);
  if (!S.slides.length) return;
  const prev = S.slides[S.idx];
  S.idx = ((i % S.slides.length) + S.slides.length) % S.slides.length;
  const cur = S.slides[S.idx];
  if (prev && prev !== cur) {
    prev.el.classList.remove('active'); prev.el.classList.add('leaving');
    setTimeout(() => prev.el.classList.remove('leaving'), 950);
    // Facebook-tijdlijn op de achtergrond verversen zodra hij uit beeld is (max. eens per 15 min)
    const f = prev.el.querySelector('iframe[data-refresh]');
    if (f && Date.now() - Number(f.dataset.loaded || 0) > 15 * 60000) {
      setTimeout(() => { f.dataset.loaded = Date.now(); f.src = f.src; }, 1000);
    }
  }
  cur.el.classList.remove('leaving'); cur.el.classList.add('active');
  fitText(cur.el); // opnieuw meten (bijv. nadat lettertypen/afbeeldingen geladen zijn)
  renderDots();
  const bar = $('#progress-bar');
  bar.style.transition = 'none'; bar.style.width = '0';
  void bar.offsetWidth;
  bar.style.transition = `width ${cur.duration}s linear`; bar.style.width = '100%';
  S.timer = setTimeout(() => show(S.idx + 1), cur.duration * 1000);
}

/* ---------- ophalen ---------- */
function applyGeneral(g) {
  S.tz = g.timezone || S.tz;
  document.documentElement.style.setProperty('--primary', g.primary || '#1f3d2b');
  document.documentElement.style.setProperty('--accent', g.accent || '#e07a2e');
  $('#brand-title').textContent = g.title || '';
  $('#brand-sub').textContent = g.subtitle || '';
  const logo = $('#logo');
  if (g.logo) { if (logo.getAttribute('src') !== g.logo) logo.src = g.logo; logo.hidden = false; } else logo.hidden = true;
  $('#ticker').hidden = !g.ticker;
  $('#ticker-text').textContent = g.ticker || '';
}

async function poll() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const st = await r.json();
    $('#offline').hidden = true;
    if (S.boot && st.boot !== S.boot) { location.reload(); return; } // server herstart / bijgewerkt
    S.boot = st.boot; S.day = S.day || st.today;
    applyGeneral(st.general);
    renderWeather(st); renderStook(st); renderAgenda(st);
    buildSlides(st);
  } catch (e) {
    console.warn('poll mislukt', e);
    $('#offline').hidden = false;
  }
}

tick();
setInterval(tick, 1000);
poll();
setInterval(poll, POLL_MS);
// Druk op pijltjes om handmatig door slides te bladeren (handig bij testen).
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(S.idx + 1);
  if (e.key === 'ArrowLeft') show(S.idx - 1);
});
