'use strict';
/* Infobord – sfeeranimaties op de achtergrond.
   Seizoenen: herfst (blaadjes), winter (sneeuw), lente (bloesem). Extra: confetti en kerstlampjes.
   Eén canvas achter de slides (max. 30 fps, pauzeert als er niets te tonen is) + kerstlampjes als HTML/CSS. */
(function () {
  const FPS = 30;
  const AMOUNT = { few: 0.5, normal: 1, many: 1.8 };
  const BASE = { autumn: 26, winter: 80, spring: 28, confetti: 55 };
  const COLORS = {
    autumn: ['#c8642b', '#e0a03a', '#a8432a', '#d9822b', '#8a5a2b', '#b5762f', '#cf4f2a'],
    spring: ['#f4a7bb', '#f7c6d4', '#e9a3c9', '#fcd5e1', '#f6b8c8', '#fff4a8'],
    confetti: ['#e07a2e', '#2f8f5b', '#f4c430', '#3b82c4', '#d6456b', '#8e5cc2', '#36b3a8'],
    lights: ['#ff4b4b', '#ffd23f', '#3fd47a', '#4aa8ff', '#ff8a2b', '#ff6bd5'],
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let canvas, ctx, W = 0, H = 0, scale = 1, raf = null, last = 0;
  let systems = {}; // naam -> array met deeltjes
  let current = '';

  /* ---------- deeltjes ---------- */
  function make(kind, spreadY) {
    const s = scale;
    const p = {
      kind, x: rnd(-20, W + 20), y: spreadY ? rnd(-H * 0.1, H) : rnd(-80, -20) * s,
      phase: rnd(0, Math.PI * 2), rot: rnd(0, Math.PI * 2), flip: rnd(0, Math.PI * 2),
    };
    if (kind === 'autumn') Object.assign(p, { size: rnd(11, 22) * s, vy: rnd(35, 70) * s, sway: rnd(25, 60) * s,
      freq: rnd(0.4, 0.9), vrot: rnd(-1.2, 1.2), vflip: rnd(1, 2.5), color: pick(COLORS.autumn) });
    if (kind === 'winter') {
      const big = Math.random() < 0.18;
      Object.assign(p, { size: (big ? rnd(5, 9) : rnd(1.6, 4)) * s, vy: (big ? rnd(30, 50) : rnd(22, 45)) * s,
        sway: rnd(10, 30) * s, freq: rnd(0.3, 0.8), vrot: rnd(-0.5, 0.5), big, alpha: rnd(0.55, 0.95) });
    }
    if (kind === 'spring') Object.assign(p, { size: rnd(7, 13) * s, vy: rnd(30, 55) * s, sway: rnd(25, 55) * s,
      freq: rnd(0.4, 0.8), vrot: rnd(-1.5, 1.5), vflip: rnd(0.8, 2), color: pick(COLORS.spring) });
    if (kind === 'confetti') Object.assign(p, { size: rnd(7, 13) * s, vy: rnd(70, 140) * s, sway: rnd(15, 40) * s,
      freq: rnd(0.8, 1.6), vrot: rnd(-3, 3), vflip: rnd(3, 7), color: pick(COLORS.confetti), round: Math.random() < 0.25 });
    p.x0 = p.x;
    return p;
  }

  function drawLeaf(p) {
    const s = p.size;
    ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(p.flip))));
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.95, -s * 0.45, s * 0.65, s * 0.6, 0, s);
    ctx.bezierCurveTo(-s * 0.65, s * 0.6, -s * 0.95, -s * 0.45, 0, -s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,10,.28)';
    ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(0, s * 1.3); ctx.stroke();
  }
  function drawFlake(p) {
    if (!p.big) {
      ctx.fillStyle = `rgba(150,176,204,${p.alpha})`;
      ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
      return;
    }
    ctx.strokeStyle = `rgba(140,168,198,${p.alpha})`;
    ctx.lineWidth = Math.max(1.2, p.size * 0.18);
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, p.size);
      ctx.moveTo(0, p.size * 0.55); ctx.lineTo(p.size * 0.25, p.size * 0.8);
      ctx.moveTo(0, p.size * 0.55); ctx.lineTo(-p.size * 0.25, p.size * 0.8);
      ctx.stroke();
    }
  }
  function drawBlossom(p) {
    const s = p.size;
    ctx.scale(1, Math.max(0.35, Math.abs(Math.cos(p.flip))));
    ctx.fillStyle = p.color;
    for (let i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath(); ctx.ellipse(0, -s * 0.55, s * 0.36, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#f2b134';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.22, 0, Math.PI * 2); ctx.fill();
  }
  function drawConfetti(p) {
    ctx.fillStyle = p.color;
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.size * 0.35, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.scale(1, Math.cos(p.flip));
    ctx.fillRect(-p.size / 2, -p.size * 0.22, p.size, p.size * 0.44);
  }
  const DRAW = { autumn: drawLeaf, winter: drawFlake, spring: drawBlossom, confetti: drawConfetti };

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / FPS - 2) return;
    const dt = Math.min(0.1, (t - last) / 1000 || 0.033);
    last = t;
    ctx.clearRect(0, 0, W, H);
    const time = t / 1000;
    for (const list of Object.values(systems)) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.y += p.vy * dt;
        p.rot += (p.vrot || 0) * dt;
        p.flip += (p.vflip || 0) * dt;
        const x = p.x0 + Math.sin(time * p.freq + p.phase) * p.sway;
        if (p.y > H + 40 * scale) { list[i] = make(p.kind, false); continue; }
        ctx.save();
        ctx.translate(x, p.y);
        ctx.rotate(p.rot);
        DRAW[p.kind](p);
        ctx.restore();
      }
    }
  }

  function resize() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    W = canvas.width = Math.round(r.width);
    H = canvas.height = Math.round(r.height);
    scale = H / 1080;
    if (lightsOn) buildLights();
  }

  function setSystems(wanted, amounts) {
    for (const name of Object.keys(systems)) if (!wanted.includes(name)) delete systems[name];
    for (const name of wanted) {
      const n = Math.round(BASE[name] * (AMOUNT[(amounts || {})[name]] || 1));
      const list = systems[name] || [];
      while (list.length < n) list.push(make(name, true));
      list.length = n;
      systems[name] = list;
    }
    document.body.classList.toggle('has-fx', Object.keys(systems).length > 0);
    if (Object.keys(systems).length && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!Object.keys(systems).length && raf) { cancelAnimationFrame(raf); raf = null; ctx.clearRect(0, 0, W, H); }
  }

  /* ---------- kerstlampjes ---------- */
  let lightsOn = false;
  function buildLights() {
    let box = document.getElementById('xmas');
    if (!box) { box = document.createElement('div'); box.id = 'xmas'; document.body.appendChild(box); }
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 20;
    const Wv = window.innerWidth;
    const segs = Math.max(3, Math.round(Wv / (rem * 11)));
    const seg = Wv / segs, sag = rem * 1.4, top = rem * 0.15, step = rem * 2.6;
    let d = `M0 ${top}`;
    for (let i = 0; i < segs; i++) d += ` Q${(i + 0.5) * seg} ${top + 2 * sag} ${(i + 1) * seg} ${top}`;
    let bulbs = '';
    let n = 0;
    for (let x = step / 2; x < Wv; x += step, n++) {
      const t = (x % seg) / seg;
      const y = top + 4 * sag * t * (1 - t);
      const ang = Math.atan((4 * sag * (1 - 2 * t)) / seg) * 180 / Math.PI;
      const c = COLORS.lights[n % COLORS.lights.length];
      bulbs += `<div class="bulb" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;transform:rotate(${ang.toFixed(1)}deg);--c:${c};`
        + `--d:${rnd(0.9, 2.6).toFixed(2)}s;--delay:-${rnd(0, 3).toFixed(2)}s"><i class="cap"></i><i class="glass"></i></div>`;
    }
    box.innerHTML = `<svg viewBox="0 0 ${Wv} ${rem * 4}" preserveAspectRatio="none"><path d="${d}" /></svg>${bulbs}`;
  }
  function setLights(on) {
    if (on === lightsOn) return;
    lightsOn = on;
    document.body.classList.toggle('has-lights', on);
    if (on) buildLights();
    else document.getElementById('xmas')?.remove();
    setTimeout(resize, 50);
  }

  /* ---------- feestbanner ---------- */
  function setMessages(msgs) {
    const bar = document.getElementById('celebrate');
    if (!bar) return;
    const m = (msgs || [])[0];
    bar.hidden = !m;
    if (m) bar.innerHTML = `<span class="emoji">${m.type === 'christmas' ? '🎄' : '🎉'}</span><span>${
      String(m.text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</span>`;
  }

  /* ---------- publieke functie ---------- */
  window.Effects = {
    counts: () => Object.fromEntries(Object.entries(systems).map(([k, v]) => [k, v.length])),
    set(fx) {
      fx = fx || {};
      // Voorbeeld via de adresbalk: /?preview=winter,confetti,lights
      const pv = new URLSearchParams(location.search).get('preview');
      if (pv) {
        const parts = pv.split(/[,+ ]/);
        fx = { season: ['autumn', 'winter', 'spring'].find((x) => parts.includes(x)) || '',
          confetti: parts.includes('confetti'), lights: parts.includes('lights'), amounts: fx.amounts,
          messages: parts.includes('confetti') ? [{ type: 'birthday', text: 'Hoera! Voorbeeld van een verjaardag 🎂' }] : [] };
      }
      const key = JSON.stringify(fx);
      if (key === current) return;
      current = key;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'fx';
        document.getElementById('stage').prepend(canvas);
        ctx = canvas.getContext('2d');
        window.addEventListener('resize', resize);
        resize();
      }
      const wanted = [];
      if (fx.season) wanted.push(fx.season);
      if (fx.confetti) wanted.push('confetti');
      setSystems(wanted.filter((w) => BASE[w]), fx.amounts);
      setLights(!!fx.lights);
      setMessages(fx.messages);
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; }
    else if (!document.hidden && !raf && Object.keys(systems).length) { last = 0; raf = requestAnimationFrame(frame); }
  });
})();
