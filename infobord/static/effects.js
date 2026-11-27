'use strict';
/* Infobord – sfeeranimaties op de achtergrond.
   Seizoenen: herfst (blaadjes), winter (sneeuw), lente (bloesem), zomer (vlinders).
   Speciale effecten: confetti, vuurvliegjes, paardenbloempluisjes, kampvuurvonkjes, zonnestralen, kerstlampjes.
   Eén canvas achter de slides (max. 30 fps, pauzeert als er niets te tonen is); zonnestralen en
   kerstlampjes zijn HTML/CSS. */
(function () {
  const FPS = 30;
  const AMOUNT = { few: 0.5, normal: 1, many: 1.8 };
  const BASE = { autumn: 26, winter: 80, spring: 28, summer: 8, confetti: 55, fireflies: 22, fluff: 14, sparks: 40 };
  const COLORS = {
    autumn: ['#c8642b', '#e0a03a', '#a8432a', '#d9822b', '#8a5a2b', '#b5762f', '#cf4f2a'],
    spring: ['#f4a7bb', '#f7c6d4', '#e9a3c9', '#fcd5e1', '#f6b8c8', '#fff4a8'],
    confetti: ['#e07a2e', '#2f8f5b', '#f4c430', '#3b82c4', '#d6456b', '#8e5cc2', '#36b3a8'],
    // vlinders: [vleugel, rand/tekening]
    summer: [['#f08a24', '#5a2a0a'], ['#f2c53d', '#6b4a0c'], ['#4a90d9', '#1d3f6b'], ['#e77fb3', '#7a2a55'], ['#7cc4a0', '#24563d']],
    lights: ['#ff4b4b', '#ffd23f', '#3fd47a', '#4aa8ff', '#ff8a2b', '#ff6bd5'],
  };
  const EMOJI = { birthday: '🎉', christmas: '🎄', fireflies: '✨', fluff: '🌼', sparks: '🔥', sunrays: '☀️' };
  const SEASONS = ['autumn', 'winter', 'spring', 'summer'];
  const EXTRAS = ['confetti', 'fireflies', 'fluff', 'sparks', 'sunrays'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  let canvas, ctx, W = 0, H = 0, scale = 1, raf = null, last = 0;
  const systems = {}; // naam -> array met deeltjes
  let current = '';

  /* ---------- deeltjes maken ---------- */
  // spread = verspreid over het hele scherm (bij het starten), anders aan de rand waar ze binnenkomen
  function make(kind, spread) {
    const s = scale;
    const p = { kind, phase: rnd(0, Math.PI * 2), rot: rnd(0, Math.PI * 2), flip: rnd(0, Math.PI * 2), x: rnd(-20, W + 20) };
    switch (kind) {
      case 'autumn':
        Object.assign(p, { size: rnd(11, 22) * s, vy: rnd(35, 70) * s, sway: rnd(25, 60) * s, freq: rnd(0.4, 0.9),
          vrot: rnd(-1.2, 1.2), vflip: rnd(1, 2.5), color: pick(COLORS.autumn) });
        break;
      case 'winter': {
        const big = Math.random() < 0.18;
        Object.assign(p, { size: (big ? rnd(5, 9) : rnd(1.6, 4)) * s, vy: (big ? rnd(30, 50) : rnd(22, 45)) * s,
          sway: rnd(10, 30) * s, freq: rnd(0.3, 0.8), vrot: rnd(-0.5, 0.5), big, alpha: rnd(0.55, 0.95) });
        break;
      }
      case 'spring':
        Object.assign(p, { size: rnd(7, 13) * s, vy: rnd(30, 55) * s, sway: rnd(25, 55) * s, freq: rnd(0.4, 0.8),
          vrot: rnd(-1.5, 1.5), vflip: rnd(0.8, 2), color: pick(COLORS.spring) });
        break;
      case 'confetti':
        Object.assign(p, { size: rnd(7, 13) * s, vy: rnd(70, 140) * s, sway: rnd(15, 40) * s, freq: rnd(0.8, 1.6),
          vrot: rnd(-3, 3), vflip: rnd(3, 7), color: pick(COLORS.confetti), round: Math.random() < 0.25 });
        break;
      case 'summer': { // vlinder: vliegt over het scherm en fladdert
        const dir = Math.random() < 0.5 ? -1 : 1;
        Object.assign(p, { size: rnd(18, 28) * s, dir, vx: dir * rnd(45, 85) * s, vy: rnd(-12, 12) * s,
          bob: rnd(15, 40) * s, freq: rnd(0.6, 1.3), flap: rnd(9, 13), colors: pick(COLORS.summer),
          x: spread ? rnd(0, W) : (dir > 0 ? -30 * s : W + 30 * s), y: rnd(H * 0.08, H * 0.92) });
        break;
      }
      case 'fireflies': // vuurvliegje: dwaalt rond en gloeit op
        Object.assign(p, { size: rnd(3.5, 5.5) * s, speed: rnd(10, 26) * s, heading: rnd(0, Math.PI * 2),
          freq: rnd(0.5, 1.4), x: rnd(0, W), y: rnd(H * 0.15, H), rot: 0 });
        break;
      case 'fluff': // paardenbloempluisje: zweeft omhoog en opzij
        Object.assign(p, { size: rnd(16, 26) * s, vy: -rnd(14, 32) * s, vx: rnd(8, 28) * s * (Math.random() < 0.7 ? 1 : -1),
          sway: rnd(15, 35) * s, freq: rnd(0.3, 0.7), vrot: rnd(-0.4, 0.4), rot: rnd(-0.4, 0.4),
          y: spread ? rnd(0, H) : H + rnd(10, 60) * s });
        break;
      case 'sparks': // kampvuurvonkje: stijgt snel op vanaf de onderkant en dooft uit
        Object.assign(p, { size: rnd(2.6, 5) * s, vy: -rnd(60, 130) * s, sway: rnd(8, 25) * s, freq: rnd(1, 2.5),
          hue: rnd(18, 45), x: rnd(W * 0.05, W * 0.95), y: spread ? rnd(H * 0.3, H) : H + rnd(0, 40) * s, rot: 0 });
        break;
    }
    if (p.y === undefined) p.y = spread ? rnd(-H * 0.1, H) : rnd(-80, -20) * s;
    p.x0 = p.x;
    return p;
  }

  /* ---------- tekenen ---------- */
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
  function drawButterfly(p, time) {
    const s = p.size, [wing, edge] = p.colors;
    ctx.scale(p.dir, 1); // kijkrichting
    const open = 0.2 + 0.8 * Math.abs(Math.sin(time * p.flap + p.phase)); // vleugelslag
    ctx.lineWidth = Math.max(1, s * 0.09);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(1, side * open);
      ctx.fillStyle = wing; ctx.strokeStyle = edge;
      // bovenvleugel (voor) en ondervleugel (achter)
      ctx.beginPath(); ctx.ellipse(s * 0.22, s * 0.55, s * 0.62, s * 0.5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-s * 0.35, s * 0.42, s * 0.42, s * 0.34, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(s * 0.4, s * 0.7, s * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // lijfje en sprieten
    ctx.fillStyle = edge; ctx.strokeStyle = edge;
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.55, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(0.8, s * 0.05);
    ctx.beginPath(); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.9, -s * 0.3); ctx.moveTo(s * 0.5, 0); ctx.lineTo(s * 0.9, s * 0.3); ctx.stroke();
  }
  function drawFirefly(p, time) {
    const glow = Math.pow(Math.max(0, Math.sin(time * p.freq + p.phase)), 2);
    const a = 0.15 + 0.85 * glow;
    ctx.fillStyle = `rgba(245,168,30,${(a * 0.3).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(0, 0, p.size * 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(240,150,20,${(a * 0.5).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(0, 0, p.size * 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(205,120,0,${Math.max(0.45, a).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
  }
  function drawFluff(p) {
    const s = p.size;
    ctx.strokeStyle = 'rgba(95,90,72,.75)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, s * 0.9); ctx.stroke(); // steeltje
    ctx.fillStyle = 'rgba(150,140,110,.8)';
    ctx.beginPath(); ctx.arc(0, s * 0.95, s * 0.09, 0, Math.PI * 2); ctx.fill(); // zaadje
    for (let i = 0; i < 9; i++) { // pluizen in een waaier
      const a = -Math.PI / 2 + (i - 4) * 0.33;
      const x = Math.cos(a) * s, y = Math.sin(a) * s * 0.85;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath(); ctx.arc(x, y, s * 0.11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  function drawSpark(p) {
    // dooft uit naarmate hij hoger komt, met wat geflakker
    const life = Math.min(1, Math.max(0, (p.y - H * 0.05) / (H * 0.6)));
    const a = life * (0.65 + 0.35 * Math.random());
    if (a <= 0.02) return;
    ctx.fillStyle = `hsla(${p.hue},95%,52%,${(a * 0.4).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(0, 0, p.size * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `hsla(${p.hue + 8},100%,50%,${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
  }
  const DRAW = { autumn: drawLeaf, winter: drawFlake, spring: drawBlossom, confetti: drawConfetti,
    summer: drawButterfly, fireflies: drawFirefly, fluff: drawFluff, sparks: drawSpark };

  /* ---------- bewegen: geeft false als het deeltje opnieuw moet beginnen ---------- */
  function fall(p, dt, time) {
    p.y += p.vy * dt; p.rot += (p.vrot || 0) * dt; p.flip += (p.vflip || 0) * dt;
    p.x = p.x0 + Math.sin(time * p.freq + p.phase) * p.sway;
    return p.y < H + 40 * scale;
  }
  function rise(p, dt, time) {
    p.y += p.vy * dt; p.rot += (p.vrot || 0) * dt * 0.3;
    p.x0 += (p.vx || 0) * dt;
    p.x = p.x0 + Math.sin(time * p.freq + p.phase) * p.sway;
    return p.y > -40 * scale && p.x > -60 * scale && p.x < W + 60 * scale;
  }
  const MOVE = {
    autumn: fall, winter: fall, spring: fall, confetti: fall, fluff: rise, sparks: rise,
    summer(p, dt, time) {
      p.x += p.vx * dt;
      p.y += (p.vy + Math.cos(time * p.freq + p.phase) * p.bob) * dt;
      if (p.y < H * 0.05 || p.y > H * 0.95) p.vy = -p.vy;
      p.rot = Math.sin(time * p.freq + p.phase) * 0.25;
      return p.x > -50 * scale && p.x < W + 50 * scale;
    },
    fireflies(p, dt) {
      p.heading += rnd(-1.6, 1.6) * dt;
      p.x += Math.cos(p.heading) * p.speed * dt;
      p.y += Math.sin(p.heading) * p.speed * dt;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < H * 0.1 || p.y > H) p.heading = -p.heading;
      return true;
    },
  };

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / FPS - 2) return;
    const dt = Math.min(0.1, (t - last) / 1000 || 0.033);
    last = t;
    ctx.clearRect(0, 0, W, H);
    const time = t / 1000;
    for (const list of Object.values(systems)) {
      for (let i = 0; i < list.length; i++) {
        let p = list[i];
        if (!MOVE[p.kind](p, dt, time)) p = list[i] = make(p.kind, false);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        DRAW[p.kind](p, time);
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
      const n = Math.max(1, Math.round(BASE[name] * (AMOUNT[(amounts || {})[name]] || 1)));
      const list = systems[name] || [];
      while (list.length < n) list.push(make(name, true));
      list.length = n;
      systems[name] = list;
    }
    const active = Object.keys(systems).length > 0;
    document.body.classList.toggle('has-fx', active || sunOn);
    if (active && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!active && raf) { cancelAnimationFrame(raf); raf = null; ctx.clearRect(0, 0, W, H); }
  }

  /* ---------- zonnestralen (CSS, draait langzaam) ---------- */
  let sunOn = false;
  function setSun(on) {
    if (on === sunOn) return;
    sunOn = on;
    let el = document.getElementById('sunrays');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'sunrays';
      el.innerHTML = '<div class="rays"></div><div class="glow"></div>';
      document.getElementById('stage').prepend(el);
    } else if (!on && el) el.remove();
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
    if (m) bar.innerHTML = `<span class="emoji">${EMOJI[m.type] || '🎉'}</span><span>${
      String(m.text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</span>`;
  }

  /* ---------- publieke functie ---------- */
  window.Effects = {
    counts: () => Object.fromEntries(Object.entries(systems).map(([k, v]) => [k, v.length])),
    set(fx) {
      fx = fx || {};
      // Voorbeeld via de adresbalk: /?preview=summer,fireflies,lights
      const pv = new URLSearchParams(location.search).get('preview');
      if (pv) {
        const parts = pv.split(/[,+ ]/);
        fx = { season: SEASONS.find((x) => parts.includes(x)) || '', extras: EXTRAS.filter((x) => parts.includes(x)),
          lights: parts.includes('lights'), amounts: fx.amounts,
          messages: parts.includes('confetti') ? [{ type: 'birthday', text: 'Hoera! Voorbeeld van een verjaardag 🎂' }] : [] };
      }
      const extras = [...(fx.extras || []), ...(fx.confetti ? ['confetti'] : [])];
      const key = JSON.stringify([fx.season, extras, fx.lights, fx.amounts, fx.messages]);
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
      setSun(extras.includes('sunrays'));
      const wanted = [fx.season, ...extras].filter((w) => w && BASE[w]);
      setSystems([...new Set(wanted)], fx.amounts);
      setLights(!!fx.lights);
      setMessages(fx.messages);
    },
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; }
    else if (!document.hidden && !raf && Object.keys(systems).length) { last = 0; raf = requestAnimationFrame(frame); }
  });
})();
