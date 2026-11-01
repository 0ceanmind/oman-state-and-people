/* ==========================================================
   Deck engine — navigation, builds, hover details, charts,
   interactive widgets, overview, presenter view.
   ========================================================== */
import { Stage3D } from './scenes.js?v=1793564796';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PRESENTER = new URLSearchParams(location.search).has('presenter');
const chan = 'BroadcastChannel' in window ? new BroadcastChannel('oman-deck') : null;

const stage = $('#stage');
const slides = $$('.slide');
const THEMES = {
  '0': { name: 'Oman: State and People', c: '#e8b86d' },
  '1': { name: 'Theme 1 · Omani Identity', c: '#e8b86d' },
  '2': { name: 'Theme 2 · Belonging, Loyalty & Citizenship', c: '#ff6b6b' },
  '3A': { name: 'Theme 3A · Contemporary Omani Renaissance', c: '#4fc3f7' },
  '3B': { name: 'Theme 3B · Authenticity & Modernity', c: '#b79cff' },
  '4': { name: 'Theme 4 · The Renewed Renaissance', c: '#3ddc97' },
};
let idx = 0;
const s3d = new Stage3D();
window.__deck = { s3d, go: i => go(i), next: () => next() };

/* ---------- scaling ---------- */
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
  window.__stageScale = s;
  s3d.resize();
}
addEventListener('resize', fit); fit();

/* ---------- navigation ---------- */
function steps(sl) { return $$('[data-step]', sl).sort((a, b) => (+a.dataset.step || 0) - (+b.dataset.step || 0)); }
function showStep(el, on) {
  el.classList.toggle('shown', on);
  if (on && el.dataset.act) runAct(el.dataset.act);
  if (el.dataset.lit) el.dataset.lit.split(' ').forEach(id => { const t = document.getElementById(id); if (t) t.classList.toggle('lit', on); });
}
function next() {
  const sl = slides[idx];
  const hidden = steps(sl).find(s => !s.classList.contains('shown'));
  if (hidden) { showStep(hidden, true); broadcast(); return; }
  go(idx + 1);
}
function prev() {
  const sl = slides[idx];
  const shown = steps(sl).filter(s => s.classList.contains('shown'));
  if (shown.length) { showStep(shown[shown.length - 1], false); broadcast(); return; }
  go(idx - 1, true);
}
function go(i, fromBack = false) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === idx && slides[i].classList.contains('active')) return;
  const old = slides[idx];
  old.classList.remove('active');
  slides.forEach((s, k) => s.classList.toggle('past', k < i));
  idx = i;
  const sl = slides[idx];
  sl.classList.add('active');
  steps(sl).forEach(s => showStep(s, fromBack));
  history.replaceState(null, '', (PRESENTER ? '?presenter' : location.pathname.split('/').pop() || '') + '#' + (idx + 1));
  chrome(); enter(sl); hidePop(true);
  broadcast();
}
function chrome() {
  const sl = slides[idx]; const th = THEMES[sl.dataset.theme || '0'];
  document.documentElement.style.setProperty('--pc', th.c);
  $('#progress').style.width = ((idx) / (slides.length - 1) * 100) + '%';
  $('#chapter').innerHTML = `<i></i>${th.name}`;
  $('#counter').textContent = `${String(idx + 1).padStart(2, '0')} / ${slides.length}`;
  $('#chapter').style.opacity = sl.dataset.chrome === 'off' ? 0 : 1;
  $('#brand').style.opacity = sl.id === 's-cover' ? 0 : 1;
}
function broadcast() { if (chan && !PRESENTER) chan.postMessage({ idx, step: steps(slides[idx]).filter(s => s.classList.contains('shown')).length }); }

/* ---------- slide enter: scenes, counters, charts ---------- */
const sceneTimers = [];
function enter(sl) {
  sceneTimers.forEach(clearTimeout); sceneTimers.length = 0;
  const host = $('[data-scene]', sl);
  if (host && s3d.ok && !PRESENTER) {
    const opts = host.dataset.opts ? JSON.parse(host.dataset.opts) : {};
    // mount after the slide transition begins so the canvas fades in with it
    sceneTimers.push(setTimeout(() => s3d.mount(host, host.dataset.scene, opts).then(() => resetWidgets(sl)), 60));
  } else { s3d.unmount(); resetWidgets(sl); }
  $$('.count', sl).forEach(countUp);
  $$('svg.donut', sl).forEach(d => drawDonut(d, d.dataset.set || 0));
  $$('.meter i[data-w]', sl).forEach(m => { m.style.width = '0'; requestAnimationFrame(() => setTimeout(() => m.style.width = m.dataset.w, 400)); });
  $$('.ba', sl).forEach(b => b.style.setProperty('--cut', '50%'));
}
function resetWidgets(sl) {
  $$('.seg', sl).forEach(seg => {
    const first = $('button', seg); if (!first) return;
    $$('button', seg).forEach(x => x.classList.toggle('on', x === first));
    if (first.dataset.act) runAct(first.dataset.act);
    if (first.dataset.show) $$('[data-panel]', sl).forEach(p => p.hidden = p.dataset.panel !== first.dataset.show);
  });
  $$('input.rng', sl).forEach(r => { r.value = r.dataset.init ?? 50; r.dispatchEvent(new Event('input')); });
  $$('[data-reset]', sl).forEach(el => el.dispatchEvent(new Event('reset')));
}
function countUp(el) {
  const to = parseFloat(el.dataset.to), dec = +(el.dataset.dec || 0), dur = 1800, t0 = performance.now() + 350;
  const f = now => {
    const u = Math.max(0, Math.min(1, (now - t0) / dur)); const e = 1 - Math.pow(1 - u, 4);
    el.textContent = (to * e).toFixed(dec);
    if (u < 1) requestAnimationFrame(f);
  };
  el.textContent = (0).toFixed(dec); requestAnimationFrame(f);
  setTimeout(() => { el.textContent = to.toFixed(dec); }, dur + 600);
}

/* ---------- actions: "cmd arg arg" → scene call ---------- */
function runAct(act) {
  act.split(';').forEach(a => {
    const [cmd, ...args] = a.trim().split(/\s+/);
    if (!cmd) return;
    s3d.call(cmd, ...args.map(x => isNaN(+x) ? x : +x));
  });
}

/* ---------- donut charts ---------- */
function drawDonut(svg, setIdx) {
  const sets = JSON.parse(svg.dataset.sets); const set = sets[setIdx];
  const r = 200, C = 2 * Math.PI * r;
  if (!svg.dataset.built) {
    svg.setAttribute('viewBox', '0 0 520 520');
    svg.innerHTML = `<circle cx="260" cy="260" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="46"/>` +
      set.v.map((_, i) => `<circle class="dseg" data-i="${i}" cx="260" cy="260" r="${r}" fill="none" stroke-width="46" stroke-linecap="butt" transform="rotate(-90 260 260)"/>`).join('') +
      `<text class="big" x="260" y="262" text-anchor="middle" font-size="96" font-weight="800" letter-spacing="-4"></text><text class="lbl" x="260" y="318" text-anchor="middle" font-size="26" fill="#a1a1a6" style="fill:#a1a1a6"></text>`;
    svg.dataset.built = 1;
    $$('.dseg', svg).forEach(c => {
      c.addEventListener('pointerenter', () => { const s = JSON.parse(svg.dataset.sets)[svg.dataset.set || 0]; const i = +c.dataset.i; $('.big', svg).textContent = s.v[i] + '%'; $('.lbl', svg).textContent = s.l[i]; });
      c.addEventListener('pointerleave', () => { const s = JSON.parse(svg.dataset.sets)[svg.dataset.set || 0]; $('.big', svg).textContent = s.v[0] + '%'; $('.lbl', svg).textContent = s.l[0]; });
    });
  }
  svg.dataset.set = setIdx;
  let acc = 0;
  $$('.dseg', svg).forEach((c, i) => {
    const frac = set.v[i] / 100, gap = 6;
    c.style.stroke = set.c[i];
    c.setAttribute('stroke-dasharray', `${Math.max(0, frac * C - gap)} ${C}`);
    c.style.strokeDashoffset = C; // start hidden
    const off = -acc * C;
    requestAnimationFrame(() => setTimeout(() => { c.style.strokeDashoffset = off; }, 300 + i * 250));
    acc += frac;
  });
  $('.big', svg).textContent = set.v[0] + '%'; $('.lbl', svg).textContent = set.l[0];
  const legend = svg.dataset.legend && document.getElementById(svg.dataset.legend);
  if (legend) legend.innerHTML = set.note || '';
}

/* ---------- hover details (popover) ---------- */
const pop = $('#pop'); let pinned = null, hideT;
function showPop(el) {
  clearTimeout(hideT);
  const title = el.dataset.dtitle || el.querySelector('h3,.nm')?.textContent || el.textContent.trim().split('\n')[0];
  const body = (el.dataset.detail || '').split('|').map(p => `<p>${p.trim()}</p>`).join('');
  const src = el.dataset.src ? `<div class="src">${el.dataset.src}</div>` : '';
  pop.innerHTML = `<div class="in"><div class="bar"></div><h4>${title}</h4>${body}${src}</div>`;
  const acc = getComputedStyle(el).getPropertyValue('--accent').trim();
  pop.style.setProperty('--pa', acc || '#e8b86d');
  const s = window.__stageScale || 1;
  const sr = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
  const x = (r.left - sr.left) / s, y = (r.top - sr.top) / s, w = r.width / s, h = r.height / s;
  pop.style.visibility = 'hidden'; pop.classList.add('show');
  const pw = 620, ph = pop.offsetHeight;
  let px = x + w + 28, py = y + h / 2 - ph / 2;
  if (px + pw > 1880) px = x - pw - 28;
  if (px < 40) { px = Math.min(1880 - pw, Math.max(40, x + w / 2 - pw / 2)); py = y + h + 24; if (py + ph > 1050) py = y - ph - 24; }
  py = Math.max(30, Math.min(1050 - ph, py));
  pop.style.left = px + 'px'; pop.style.top = py + 'px'; pop.style.visibility = '';
  $$('.hot.open').forEach(o => o !== el && o.classList.remove('open'));
  el.classList.add('open');
}
function hidePop(force) {
  if (pinned && !force) return;
  pinned = null;
  hideT = setTimeout(() => { pop.classList.remove('show'); $$('.hot.open').forEach(o => o.classList.remove('open')); }, force ? 0 : 120);
}
stage.addEventListener('pointerover', e => { const h = e.target.closest('.hot'); if (h && !pinned && h.dataset.detail) showPop(h); });
stage.addEventListener('pointerout', e => { const h = e.target.closest('.hot'); if (h && !h.contains(e.relatedTarget)) hidePop(); });
stage.addEventListener('click', e => {
  const h = e.target.closest('.hot');
  if (h && h.dataset.detail) { if (pinned === h) { pinned = null; hidePop(true); } else { pinned = null; showPop(h); pinned = h; } e.stopPropagation(); return; }
  if (pinned) hidePop(true);
});

/* ---------- interactive widgets ---------- */
// segmented controls / buttons that call scene actions
stage.addEventListener('click', e => {
  const b = e.target.closest('[data-act]:not([data-step])'); if (!b) return;
  const seg = b.closest('.seg'); if (seg) $$('button', seg).forEach(x => x.classList.toggle('on', x === b));
  runAct(b.dataset.act);
  if (b.dataset.donut) { const d = document.getElementById(b.dataset.donut); drawDonut(d, +b.dataset.set); }
  if (b.dataset.show) { const sl = b.closest('.slide'); $$('[data-panel]', sl).forEach(p => p.hidden = p.dataset.panel !== b.dataset.show); }
});
// agenda jump
stage.addEventListener('click', e => { const j = e.target.closest('[data-goto]'); if (j) { const t = slides.findIndex(s => s.id === j.dataset.goto); if (t >= 0) go(t); } });

// before / after slider
$$('.ba').forEach(ba => {
  const set = x => { const r = ba.getBoundingClientRect(); const v = Math.max(4, Math.min(96, (x - r.left) / r.width * 100)); ba.style.setProperty('--cut', v + '%'); };
  let drag = false;
  ba.addEventListener('pointerdown', e => { drag = true; ba.setPointerCapture(e.pointerId); set(e.clientX); });
  ba.addEventListener('pointermove', e => drag && set(e.clientX));
  ba.addEventListener('pointerup', () => drag = false);
});

// range sliders wired to a scene action / meter
$$('input.rng').forEach(r => r.addEventListener('input', () => {
  const v = +r.value; r.style.setProperty('--v', v + '%');
  if (r.dataset.tilt) s3d.call('setTilt', (v - 50) / 50 * (r.dataset.tilt === 'inv' ? -1 : 1));
  if (r.dataset.out) {
    const out = document.getElementById(r.dataset.out);
    const msgs = JSON.parse(r.dataset.msgs);
    const m = v < 30 ? msgs[0] : v > 70 ? msgs[2] : msgs[1];
    out.innerHTML = m;
  }
  if (r.dataset.meter) { const m = document.getElementById(r.dataset.meter); m.style.setProperty('--w', v + '%'); m.querySelector('i').style.width = v + '%'; const n = document.getElementById(r.dataset.meter + '-n'); if (n) n.textContent = v; }
}));

// rights & responsibilities balance
$$('[data-rr]').forEach(box => {
  const counts = [0, 0]; const out = $('.rr-out', box);
  const upd = () => {
    const d = counts[1] - counts[0];
    s3d.call('setTilt', Math.max(-1, Math.min(1, d / 3)));
    out.innerHTML = counts[0] + counts[1] === 0 ? 'Tap a right or a duty to place it on the scale'
      : d === 0 ? '<b class="accent">Balanced</b> — sound citizenship pairs rights with duties'
      : d < 0 ? 'Rights outweigh duties — the scale tips' : 'Duties outweigh rights — the scale tips';
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-side]'); if (!b || b.disabled) return;
    const side = +b.dataset.side; counts[side]++; b.disabled = true; b.classList.add('used');
    s3d.call('addBlock', side); upd();
  });
  box.addEventListener('reset', () => { counts[0] = counts[1] = 0; $$('[data-side]', box).forEach(b => { b.disabled = false; b.classList.remove('used'); }); s3d.call('reset'); upd(); });
  box.dataset.reset = 1;
});

/* ---------- keyboard, touch, chrome ---------- */
addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) return;
  const k = e.key;
  if (document.body.classList.contains('overview') && k !== 'o' && k !== 'O' && k !== 'Escape') return;
  if (['ArrowRight', 'PageDown', ' ', 'Enter', 'ArrowDown'].includes(k)) { e.preventDefault(); next(); }
  else if (['ArrowLeft', 'PageUp', 'Backspace', 'ArrowUp'].includes(k)) { e.preventDefault(); prev(); }
  else if (k === 'Home') go(0); else if (k === 'End') go(slides.length - 1);
  else if (k === 'f' || k === 'F') toggleFS();
  else if (k === 'o' || k === 'O') toggleOverview();
  else if (k === 'Escape') { document.body.classList.remove('overview', 'help', 'black'); }
  else if (k === 'b' || k === 'B' || k === '.') document.body.classList.toggle('black');
  else if (k === 'p' || k === 'P') openPresenter();
  else if (k === 'q' || k === 'Q') window.open('quiz.html', '_blank');
  else if (k === '?' || k === 'h' || k === 'H') document.body.classList.toggle('help');
});
let tx = null;
addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
addEventListener('touchend', e => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 60 && !e.target.closest('.ba,.canvas-host,input')) dx < 0 ? next() : prev(); tx = null; });
let uiT; addEventListener('mousemove', () => { document.body.classList.add('ui'); clearTimeout(uiT); uiT = setTimeout(() => document.body.classList.remove('ui'), 2600); });
function toggleFS() { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }
$('#nav').addEventListener('click', e => {
  const a = e.target.closest('button')?.dataset.nav; if (!a) return;
  ({ prev, next, fs: toggleFS, ov: toggleOverview, quiz: () => window.open('quiz.html', '_blank'), help: () => document.body.classList.toggle('help'), pres: openPresenter })[a]();
});

/* ---------- overview ---------- */
function toggleOverview() {
  const on = document.body.classList.toggle('overview');
  if (!on) return;
  const ov = $('#overview'); let html = '', last = null;
  slides.forEach((s, i) => {
    const th = s.dataset.theme || '0';
    if (th !== last) { if (last !== null) html += '</div>'; html += `<h3>${THEMES[th].name}</h3><div class="ov-grid">`; last = th; }
    html += `<button style="--oc:${THEMES[th].c}" class="${i === idx ? 'cur' : ''}" data-i="${i}"><b>${String(i + 1).padStart(2, '0')}</b><span>${s.dataset.title || ''}</span></button>`;
  });
  ov.innerHTML = html + '</div>';
  $('.cur', ov)?.scrollIntoView({ block: 'center' });
}
$('#overview').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { document.body.classList.remove('overview'); go(+b.dataset.i); } });

/* ---------- presenter view ---------- */
function openPresenter() { window.open(location.pathname + '?presenter#' + (idx + 1), 'oman-presenter', 'width=1100,height=760'); }
if (PRESENTER) initPresenter();
function initPresenter() {
  document.body.innerHTML = `<div id="pv"><header><div id="pv-clock">00:00</div><div id="pv-pos"></div><button id="pv-reset">Reset timer</button></header>
  <main><section><small>NOW</small><h1 id="pv-title"></h1><div id="pv-notes"></div></section>
  <aside><small>NEXT</small><h2 id="pv-next"></h2><div class="pv-btns"><button id="pv-prev">◀ Prev</button><button id="pv-nxt">Next ▶</button></div><p class="pv-hint">Controls the main window · keys ← → work here too</p></aside></main></div>`;
  const st = document.createElement('style');
  st.textContent = `#pv{position:fixed;inset:0;background:#0b0c10;color:#f5f5f7;font-family:Inter,system-ui;display:flex;flex-direction:column;padding:28px 36px;overflow:auto}
  #pv header{display:flex;align-items:center;gap:24px;margin-bottom:22px}#pv-clock{font-size:44px;font-weight:800;font-variant-numeric:tabular-nums}#pv-pos{color:#8e8e93;font-size:18px;flex:1}
  #pv button{all:unset;cursor:pointer;background:#1d1f27;border:1px solid #2c2f3a;border-radius:12px;padding:12px 18px;font-weight:600}
  #pv main{display:grid;grid-template-columns:1.6fr 1fr;gap:28px;flex:1}#pv section,#pv aside{background:#13151c;border:1px solid #23262f;border-radius:20px;padding:26px}
  #pv small{color:#8e8e93;letter-spacing:.14em;font-weight:700}#pv h1{font-size:34px;margin:10px 0 18px}#pv h2{font-size:24px;margin:10px 0 22px;color:#c7c7cc}
  #pv-notes{font-size:22px;line-height:1.55;color:#d8d8dd}#pv-notes li{margin:0 0 10px 22px}.pv-btns{display:flex;gap:12px}.pv-hint{color:#6e6e73;margin-top:16px;font-size:14px}`;
  document.head.appendChild(st);
  let t0 = Date.now(); let cur = (parseInt(location.hash.slice(1)) || 1) - 1;
  const render = () => {
    const s = slides[cur], n = slides[cur + 1];
    $('#pv-title').textContent = s.dataset.title || '';
    const notes = (s.dataset.notes || '').split('|').filter(Boolean);
    $('#pv-notes').innerHTML = notes.length ? '<ul>' + notes.map(x => `<li>${x}</li>`).join('') + '</ul>' : '<p style="color:#6e6e73">No notes.</p>';
    $('#pv-next').textContent = n ? n.dataset.title : '— End —';
    $('#pv-pos').textContent = `Slide ${cur + 1} of ${slides.length} · ${THEMES[s.dataset.theme || '0'].name}`;
  };
  render();
  setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); $('#pv-clock').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 500);
  $('#pv-reset').onclick = () => t0 = Date.now();
  const send = d => chan && chan.postMessage({ cmd: d });
  $('#pv-prev').onclick = () => send('prev'); $('#pv-nxt').onclick = () => send('next');
  addEventListener('keydown', e => { if (['ArrowRight', 'PageDown', ' '].includes(e.key)) send('next'); if (['ArrowLeft', 'PageUp'].includes(e.key)) send('prev'); });
  chan && chan.addEventListener('message', e => { if (e.data.idx != null) { cur = e.data.idx; render(); } });
  send('sync');
}
if (!PRESENTER && chan) chan.addEventListener('message', e => {
  if (e.data.cmd === 'next') next(); else if (e.data.cmd === 'prev') prev(); else if (e.data.cmd === 'sync') broadcast();
});

$$('.flow path.wire').forEach(p => p.style.setProperty('--len', p.getTotalLength()));

/* ---------- start ---------- */
if (!PRESENTER) {
  const start = Math.max(0, (parseInt(location.hash.slice(1)) || 1) - 1);
  slides.forEach(s => s.classList.remove('active'));
  idx = start; slides[idx].classList.add('active'); chrome(); enter(slides[idx]);
  document.fonts?.ready.then(fit);
}
