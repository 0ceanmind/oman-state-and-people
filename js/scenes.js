/* ==========================================================
   3D scenes (Three.js). One shared WebGL renderer is moved
   into whichever slide is active, so only one scene renders.
   ========================================================== */
import * as THREE from '../assets/vendor/three.module.min.js';

const DEG = Math.PI / 180;
const data = { region: null, dots: null };
async function loadData() {
  if (!data.region) {
    const [r, d] = await Promise.all([
      fetch('assets/data/region.json').then(r => r.json()),
      fetch('assets/data/dots.json').then(r => r.json()),
    ]);
    data.region = r; data.dots = d;
  }
  return data;
}

const css = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim() || '#e8b86d';
const ease = t => 1 - Math.pow(1 - t, 3);
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.45, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _dotTex; const DOT = () => _dotTex || (_dotTex = dotTexture());

function glowSprite(color, size) {
  const m = new THREE.SpriteMaterial({ map: DOT(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(m); s.scale.setScalar(size); return s;
}

/* label helper: HTML element that follows a 3D point */
function makeLabel(host, text, opts = {}) {
  const el = document.createElement('div');
  el.className = 'lab' + (opts.big ? ' big' : '') + (opts.detail ? ' hot' : '');
  el.innerHTML = (opts.dot === false ? '' : '<span class="dt"></span>') + text;
  if (opts.color) el.style.setProperty('--accent', opts.color);
  if (opts.detail) { el.dataset.detail = opts.detail; el.dataset.dtitle = opts.dtitle || text.replace(/<[^>]+>/g, ''); if (opts.src) el.dataset.src = opts.src; }
  el.style.opacity = 0;
  host.appendChild(el);
  return el;
}

/* ==========================================================
   Engine
   ========================================================== */
export class Stage3D {
  constructor() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) { this.renderer = null; console.warn('WebGL unavailable', e); return; }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.clock = new THREE.Clock();
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.cur = null;
    window.addEventListener('pointermove', e => {
      this.pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    });
    const loop = () => { requestAnimationFrame(loop); this.frame(); };
    loop();
  }
  get ok() { return !!this.renderer; }

  async mount(host, name, opts = {}) {
    if (!this.ok) return;
    this.unmount();
    await loadData();
    const factory = SCENES[name];
    if (!factory) return console.warn('no scene', name);
    let labels = host.querySelector('.labels');
    if (!labels) { labels = document.createElement('div'); labels.className = 'labels'; host.appendChild(labels); }
    labels.innerHTML = '';
    host.prepend(this.renderer.domElement);
    const w = host.offsetWidth, h = host.offsetHeight;
    const sc = factory({ host, labels, w, h, opts, engine: this });
    sc.host = host; sc.w = w; sc.h = h; sc.t0 = this.clock.getElapsedTime(); sc.labelsHost = labels;
    sc.camera.aspect = w / h; sc.camera.updateProjectionMatrix();
    this.cur = sc;
    this.resize();
  }
  unmount() {
    if (!this.cur) return;
    const sc = this.cur; this.cur = null;
    sc.dispose && sc.dispose();
    sc.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    if (sc.labelsHost) sc.labelsHost.innerHTML = '';
    this.renderer.domElement.remove();
  }
  resize() {
    if (!this.cur) return;
    const scale = (window.__stageScale || 1);
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * scale);
    this.renderer.setPixelRatio(Math.max(.75, dpr));
    this.renderer.setSize(this.cur.w, this.cur.h, false);
  }
  /* send a command to the current scene (e.g. focus, set tilt) */
  call(cmd, ...a) { if (this.cur && this.cur[cmd]) this.cur[cmd](...a); }

  frame() {
    const sc = this.cur; if (!sc) return;
    const p = this.pointer; p.x += (p.tx - p.x) * .05; p.y += (p.ty - p.y) * .05;
    const t = this.clock.getElapsedTime() - sc.t0;
    sc.update && sc.update(t, p);
    this.renderer.render(sc.scene, sc.camera);
    // project labels
    if (sc.labels) {
      const v = new THREE.Vector3();
      for (const L of sc.labels) {
        L.obj ? L.obj.getWorldPosition(v) : v.copy(L.pos);
        if (L.offset) v.add(L.offset);
        v.project(sc.camera);
        const x = (v.x * .5 + .5) * sc.w, y = (-v.y * .5 + .5) * sc.h;
        L.el.style.left = x + 'px'; L.el.style.top = y + 'px';
        let vis = t > (L.delay || 0) && v.z < 1;
        if (L.facing) vis = vis && L.facing();
        L.el.style.opacity = vis ? (L.alpha ?? 1) : 0;
        L.el.style.pointerEvents = vis ? 'auto' : 'none';
      }
    }
  }
}

function baseScene(w, h, fov = 40) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, w / h, .1, 500);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a2030, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-6, 10, 12); scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 1.2); rim.position.set(8, -4, -6); scene.add(rim);
  return { scene, camera };
}

/* ==========================================================
   1. Oman — extruded 3D map
   ========================================================== */
const LON0 = 56.6, LAT0 = 21.0, KX = Math.cos(21 * DEG);
const proj = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0)];

function omanMap({ host, labels, w, h, opts }) {
  const { scene, camera } = baseScene(w, h, 34);
  const accent = new THREE.Color(opts.color || css('--accent', host));
  const g = new THREE.Group(); scene.add(g);
  g.rotation.x = -(opts.tilt ?? 0.95);
  const depth = .42;

  // neighbours (flat, dim)
  const nMat = new THREE.MeshBasicMaterial({ color: 0x141821 });
  const nLine = new THREE.LineBasicMaterial({ color: 0x2c3240, transparent: true, opacity: .9 });
  for (const [name, polys] of Object.entries(data.region)) {
    if (name === 'Oman') continue;
    for (const poly of polys) {
      const pts = poly[0].map(([x, y]) => new THREE.Vector2(...proj(x, y)));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)), nMat); m.position.z = -.02; g.add(m);
      const lg = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, 0)));
      g.add(new THREE.LineLoop(lg, nLine));
    }
  }
  // sea dot grid
  {
    const pos = [];
    for (let lon = 44; lon <= 70; lon += .5) for (let lat = 8; lat <= 33; lat += .5) { const [x, y] = proj(lon, lat); pos.push(x, y, -.06); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: .07, map: DOT(), color: 0x3a6fa0, transparent: true, opacity: .45, depthWrite: false })));
  }
  // Oman extruded
  const capMat = new THREE.MeshStandardMaterial({ color: opts.cap || 0x2a2218, roughness: .55, metalness: .35, emissive: accent.clone().multiplyScalar(.08) });
  const sideMat = new THREE.MeshStandardMaterial({ color: accent, roughness: .3, metalness: .75, emissive: accent.clone().multiplyScalar(.25) });
  const omanG = new THREE.Group(); g.add(omanG);
  const edgeMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 1 });
  for (const poly of data.region.Oman) {
    const pts = poly[0].map(([x, y]) => new THREE.Vector2(...proj(x, y)));
    const shape = new THREE.Shape(pts);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .05, bevelSize: .04, bevelSegments: 2, steps: 1 });
    const mesh = new THREE.Mesh(geo, [capMat, sideMat]); omanG.add(mesh);
    const lg = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, depth + .06)));
    omanG.add(new THREE.LineLoop(lg, edgeMat));
  }
  // glow under Oman
  const halo = glowSprite(accent, 16); halo.position.set(0, 0, -.3); halo.material.opacity = .25; g.add(halo);

  // floating dust
  const dustGeo = new THREE.BufferGeometry(); const dp = [];
  for (let i = 0; i < 600; i++) dp.push((Math.random() - .5) * 26, (Math.random() - .5) * 22, Math.random() * 6);
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: .06, map: DOT(), color: accent, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(dust);

  // markers
  const L = []; const pulses = [];
  (opts.markers || []).forEach((m, i) => {
    const [x, y] = proj(m.lon, m.lat);
    const col = new THREE.Color(m.color || '#ffffff');
    const top = depth + .07;
    const beamH = m.h ?? 1.3;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, beamH, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .85 }));
    beam.rotation.x = Math.PI / 2; beam.position.set(x, y, top + beamH / 2); g.add(beam);
    const head = glowSprite(col, .9); head.position.set(x, y, top + beamH); g.add(head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.12, .17, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.set(x, y, top); g.add(ring); pulses.push({ ring, ph: i * .7 });
    const el = makeLabel(labels, m.label, { color: m.color, big: m.big, detail: m.detail, dtitle: m.dtitle, src: m.src });
    L.push({ el, obj: head, offset: new THREE.Vector3(0, m.dy ?? .45, 0), delay: 1.2 + i * .25 });
  });

  // cyclone (vortex of particles)
  let vortex = null, vortexTarget = null;
  if (opts.cyclone) {
    const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const arm = i % 4, r = Math.pow(Math.random(), .7) * 3.2;
      const a = arm * Math.PI / 2 + r * 1.9 + (Math.random() - .5) * .55;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r; pos[i * 3 + 2] = .6 + Math.random() * .5 * (1 - r / 3.2) + .2;
      const c = new THREE.Color().setHSL(.56, .6, .55 + (1 - r / 3.2) * .4); col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    vortex = new THREE.Points(geo, new THREE.PointsMaterial({ size: .09, map: DOT(), vertexColors: true, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    const eye = glowSprite(0xffffff, .7); eye.position.z = .9; vortex.add(eye);
    g.add(vortex);
    const [x, y] = proj(...opts.cyclone); vortex.position.set(x + 2.5, y - 2.5, 0); vortexTarget = new THREE.Vector3(x, y, 0);
  }

  const camTarget = new THREE.Vector3(...(opts.look || [0, -.4, 0]));
  const dist = (opts.dist || 24) * 1.38;
  camera.position.set(0, 0, dist * 1.6);
  const sc = { scene, camera, labels: L };
  sc.setCyclone = (lon, lat) => { if (!vortexTarget) return; const [x, y] = proj(lon, lat); vortexTarget.set(x, y, 0); };
  sc.update = (t, p) => {
    const k = ease(Math.min(1, t / 2.4));
    const spin = opts.spin ? Math.sin(t * .15) * .25 : 0;
    camera.position.set(Math.sin(spin) * dist * .2 + p.x * 1.5, -p.y * 1.2 + (opts.camY || 0), dist * (1.6 - .6 * k));
    camera.lookAt(camTarget);
    g.rotation.z = (opts.rotZ || 0) + spin * .4 + (1 - k) * .4;
    omanG.position.z = (1 - k) * -1.5;
    dust.rotation.z = t * .01; dust.position.z = Math.sin(t * .3) * .2;
    pulses.forEach(({ ring, ph }) => { const s = 1 + ((t * .8 + ph) % 1.6) * 2.4; ring.scale.setScalar(s); ring.material.opacity = Math.max(0, 1 - (s - 1) / 3.8); });
    if (vortex) { vortex.rotation.z = -t * 1.1; vortex.position.lerp(vortexTarget, .02); }
  };
  return sc;
}

/* ==========================================================
   2. Globe — dotted earth, voyages & influence arcs
   ========================================================== */
const R = 5;
const sph = (lon, lat, r = R) => new THREE.Vector3(r * Math.cos(lat * DEG) * Math.sin(lon * DEG), r * Math.sin(lat * DEG), r * Math.cos(lat * DEG) * Math.cos(lon * DEG));

function routeCurve(points, lift, mode) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = sph(...points[i]).normalize(), b = sph(...points[i + 1]).normalize();
    const ang = a.angleTo(b); const n = Math.max(6, Math.ceil(ang / (2 * DEG)));
    for (let j = 0; j < n; j++) {
      const t = j / n; const s = Math.sin(ang);
      const v = s < 1e-6 ? a.clone() : a.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).add(b.clone().multiplyScalar(Math.sin(t * ang) / s));
      out.push(v);
    }
  }
  out.push(sph(...points[points.length - 1]).normalize());
  const total = out.length - 1;
  const pts = out.map((v, i) => {
    const u = i / total;
    const h = mode === 'arc' ? lift * Math.sin(Math.PI * u) : lift;
    return v.multiplyScalar(R * (1 + .012 + h));
  });
  return new THREE.CatmullRomCurve3(pts);
}

function globe({ host, labels, w, h, opts }) {
  const { scene, camera } = baseScene(w, h, 30);
  const accent = new THREE.Color(opts.color || css('--accent', host));
  const g = new THREE.Group(); scene.add(g);
  const tilt = new THREE.Group(); tilt.add(g); scene.add(tilt);

  // occluding core sphere
  const core = new THREE.Mesh(new THREE.SphereGeometry(R * .985, 64, 64), new THREE.MeshStandardMaterial({ color: 0x0b0f18, roughness: .9, metalness: .1, emissive: 0x05080f }));
  g.add(core);
  // land dots
  const d = data.dots, pos = new Float32Array(d.length / 2 * 3), col = new Float32Array(d.length / 2 * 3);
  const base = new THREE.Color(0x9fb3c8), hi = accent.clone();
  for (let i = 0; i < d.length / 2; i++) {
    const v = sph(d[i * 2], d[i * 2 + 1], R * 1.002); pos.set([v.x, v.y, v.z], i * 3);
    // highlight Oman region
    const near = (opts.highlight || [[57, 21, 5]]).some(([lo, la, r]) => Math.hypot(d[i * 2] - lo, d[i * 2 + 1] - la) < r);
    const c = near ? hi : base; col.set([c.r, c.g, c.b], i * 3);
  }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); dg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.add(new THREE.Points(dg, new THREE.PointsMaterial({ size: .085, map: DOT(), vertexColors: true, transparent: true, opacity: .95, depthWrite: false })));

  // atmosphere
  const atm = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 64, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: { c: { value: new THREE.Color(0x3a6fb5) } },
    vertexShader: 'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 c; varying vec3 vN; void main(){ float i=pow(.72-dot(vN,vec3(0,0,1.)),3.); gl_FragColor=vec4(c,1.)*i*.85; }'
  }));
  scene.add(atm);

  // routes
  const routes = [];
  (opts.routes || []).forEach((r, ri) => {
    const curve = routeCurve(r.pts, r.lift ?? .015, r.mode || 'sea');
    const segs = Math.min(600, r.pts.length * 60);
    const tube = new THREE.TubeGeometry(curve, segs, r.width || .035, 8, false);
    const c = new THREE.Color(r.color || accent);
    const mesh = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .95 }));
    const idx = tube.index.count; tube.setDrawRange(0, 0); g.add(mesh);
    const head = glowSprite(c, .7); g.add(head);
    const headCore = new THREE.Mesh(new THREE.SphereGeometry(.07, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff })); head.add(headCore);
    routes.push({ curve, tube, idx, mesh, head, delay: (r.delay ?? .8 + ri * .4), dur: r.dur || 4.5, on: r.on !== false, prog: 0, group: r.group });
  });

  // markers
  const L = [];
  (opts.markers || []).forEach((m, i) => {
    const c = new THREE.Color(m.color || '#ffffff');
    const p = sph(m.lon, m.lat, R * 1.015);
    const dot = glowSprite(c, m.size || .6); dot.position.copy(p); g.add(dot);
    const pin = new THREE.Mesh(new THREE.SphereGeometry(.06, 12, 12), new THREE.MeshBasicMaterial({ color: c })); pin.position.copy(p); g.add(pin);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.1, .14, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(p); ring.lookAt(p.clone().multiplyScalar(2)); g.add(ring);
    const el = makeLabel(labels, m.label, { color: m.color, big: m.big, detail: m.detail, dtitle: m.dtitle, src: m.src });
    const wp = new THREE.Vector3();
    L.push({ el, obj: pin, offset: new THREE.Vector3(m.dx || 0, m.dy ?? .42, 0), delay: m.delay ?? (1 + i * .2), group: m.group,
      ring, facing: () => { pin.getWorldPosition(wp); return wp.z > R * .25; } });
  });

  // stars
  const sg = new THREE.BufferGeometry(); const sp = [];
  for (let i = 0; i < 1200; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 60); sp.push(v.x, v.y, v.z); }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: .35, map: DOT(), color: 0xffffff, transparent: true, opacity: .5, depthWrite: false })));

  // view control
  let [flon, flat] = opts.focus || [57, 20];
  const cur = { lon: flon - 60, lat: flat - 20 }, tgt = { lon: flon, lat: flat };
  let drag = null, dragOff = { lon: 0, lat: 0 };
  const onDown = e => { drag = { x: e.clientX, y: e.clientY, lon: dragOff.lon, lat: dragOff.lat }; };
  const onMove = e => { if (!drag) return; dragOff.lon = drag.lon - (e.clientX - drag.x) * .25; dragOff.lat = Math.max(-60, Math.min(60, drag.lat + (e.clientY - drag.y) * .2)); };
  const onUp = () => { drag = null; };
  host.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);

  const dist = (opts.dist || 19) * 1.45;
  camera.position.set(0, 0, dist);
  if (opts.offsetX) camera.setViewOffset(w, h, -opts.offsetX, 0, w, h);
  const sc = { scene, camera, labels: L };
  sc.focus = (lon, lat) => { tgt.lon = lon; tgt.lat = lat; dragOff.lon = 0; dragOff.lat = 0; };
  sc.show = (group) => {
    routes.forEach(r => { if (r.group) { r.on = r.group === group || group === 'all'; if (r.on) { r.prog = 0; r.start = null; } } });
    L.forEach(l => { if (l.group) l.alpha = (l.group === group || group === 'all') ? 1 : 0; });
  };
  sc.dispose = () => { host.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  sc.update = (t, p) => {
    const k = Math.min(1, t / 3);
    const drift = opts.drift ? Math.sin(t * .1) * 6 : 0;
    cur.lon += ((tgt.lon + dragOff.lon + drift) - cur.lon) * (.03 + .02 * k);
    cur.lat += ((tgt.lat + dragOff.lat) - cur.lat) * .04;
    g.rotation.y = -cur.lon * DEG; tilt.rotation.x = cur.lat * DEG;
    tilt.rotation.y = p.x * .05; tilt.rotation.z = 0;
    camera.position.z = dist + (1 - ease(k)) * 10;
    camera.lookAt(0, 0, 0);
    atm.rotation.copy(tilt.rotation);
    for (const r of routes) {
      if (!r.on) { r.tube.setDrawRange(0, 0); r.head.visible = false; continue; }
      if (r.start == null) r.start = t + (r.prog === 0 ? r.delay : 0);
      const u = Math.max(0, Math.min(1, (t - r.start) / r.dur));
      const e = easeIO(u);
      r.tube.setDrawRange(0, Math.floor(r.idx * e / 6) * 6);
      r.head.visible = u > 0;
      r.head.position.copy(r.curve.getPointAt(Math.min(.9999, e)));
      r.head.scale.setScalar(.7 + Math.sin(t * 6) * .12);
    }
    L.forEach(l => { if (l.ring) { const s = 1 + ((t * .9) % 1.4) * 2; l.ring.scale.setScalar(s); l.ring.material.opacity = Math.max(0, 1 - (s - 1) / 2.8) * (l.alpha ?? 1); } });
  };
  return sc;
}

/* ==========================================================
   3. Orbit — concepts orbiting a glowing core
   ========================================================== */
function orbit({ host, labels, w, h, opts }) {
  const { scene, camera } = baseScene(w, h, 36);
  const accent = new THREE.Color(opts.color || css('--accent', host));
  const g = new THREE.Group(); scene.add(g); g.rotation.x = .38;
  // core: glass-like icosahedron + inner glow
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 4), new THREE.MeshPhysicalMaterial({ color: accent, metalness: .2, roughness: .15, transmission: .6, thickness: 1.2, clearcoat: 1, emissive: accent.clone().multiplyScalar(.35), transparent: true, opacity: .95 }));
  scene.add(core);
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.75, 1), new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: .25 }));
  scene.add(wire);
  const glow = glowSprite(accent, 6.5); glow.material.opacity = .28; scene.add(glow);
  const coreEl = opts.core ? makeLabel(labels, opts.core, { big: true, dot: false, detail: opts.coreDetail, dtitle: opts.core }) : null;

  const items = opts.items || [];
  const rad = opts.radius || 4.6;
  const ringGeo = new THREE.TorusGeometry(rad, .012, 8, 200);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .18 }));
  ring.rotation.x = Math.PI / 2; g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(rad * 1.25, .008, 8, 200), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .12 }));
  ring2.rotation.x = Math.PI / 2; g.add(ring2);

  const orbs = []; const L = [];
  if (coreEl) L.push({ el: coreEl, pos: new THREE.Vector3(0, 0, 0), delay: .6 });
  items.forEach((it, i) => {
    const c = new THREE.Color(it.color || accent);
    const piv = new THREE.Group(); g.add(piv);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.5, 48, 48), new THREE.MeshPhysicalMaterial({ color: c, metalness: .3, roughness: .2, clearcoat: 1, emissive: c.clone().multiplyScalar(.45) }));
    orb.position.x = rad; piv.add(orb);
    const gl = glowSprite(c, 2.1); gl.material.opacity = .32; orb.add(gl);
    // connector line to core
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(rad, 0, 0)]);
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: .35 })); piv.add(line);
    piv.rotation.y = (i / items.length) * Math.PI * 2;
    orbs.push({ piv, orb, base: piv.rotation.y });
    const el = makeLabel(labels, it.label, { color: '#' + c.getHexString(), big: true, detail: it.detail, dtitle: it.dtitle || it.label, src: it.src });
    L.push({ el, obj: orb, offset: new THREE.Vector3(0, .95, 0), delay: .9 + i * .25 });
  });

  // particles
  const pg = new THREE.BufferGeometry(); const pp = [];
  for (let i = 0; i < 900; i++) { const a = Math.random() * Math.PI * 2, r = rad * (.4 + Math.random() * 1.2); pp.push(Math.cos(a) * r, (Math.random() - .5) * 2.4, Math.sin(a) * r); }
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  const parts = new THREE.Points(pg, new THREE.PointsMaterial({ size: .06, map: DOT(), color: accent, transparent: true, opacity: .6, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(parts);

  camera.position.set(0, 3.2, 18.5); camera.lookAt(0, -.3, 0);
  const sc = { scene, camera, labels: L };
  sc.update = (t, p) => {
    const k = ease(Math.min(1, t / 2));
    g.scale.setScalar(.6 + .4 * k);
    orbs.forEach(o => { o.piv.rotation.y = o.base + t * (opts.speed ?? .16); o.orb.rotation.y = t; });
    core.rotation.y = t * .3; core.rotation.x = t * .17; wire.rotation.y = -t * .12; wire.rotation.z = t * .08;
    core.scale.setScalar(k * (1 + Math.sin(t * 2) * .03));
    parts.rotation.y = t * .05;
    g.rotation.z = p.x * .08; g.rotation.x = .38 + p.y * .06;
  };
  return sc;
}

/* ==========================================================
   4. Rings — three interlocking concepts
   ========================================================== */
function rings({ host, labels, w, h, opts }) {
  const { scene, camera } = baseScene(w, h, 36);
  const items = opts.items;
  const g = new THREE.Group(); scene.add(g);
  const L = [];
  const meshes = items.map((it, i) => {
    const c = new THREE.Color(it.color);
    const a = i / items.length * Math.PI * 2 - Math.PI / 2;
    const m = new THREE.Mesh(new THREE.TorusGeometry(2.6, .32, 48, 160), new THREE.MeshPhysicalMaterial({ color: c, metalness: .55, roughness: .22, clearcoat: 1, clearcoatRoughness: .1, emissive: c.clone().multiplyScalar(.22) }));
    m.position.set(Math.cos(a) * 1.75, Math.sin(a) * 1.75, 0);
    m.rotation.set((i - 1) * .55, (i - 1) * -.35 + .2, 0);
    g.add(m);
    const gl = glowSprite(c, 7); gl.material.opacity = .25; gl.position.copy(m.position); g.add(gl);
    const el = makeLabel(labels, it.label, { color: it.color, big: true, detail: it.detail, dtitle: it.label, src: it.src });
    L.push({ el, pos: new THREE.Vector3(Math.cos(a) * 4.7, Math.sin(a) * 4.7 + (i === 0 ? .35 : -.2), 0), delay: .8 + i * .3 });
    return m;
  });
  const core = glowSprite(0xffffff, 3.6); core.material.opacity = .7; g.add(core);
  camera.position.set(0, 0, 17); camera.lookAt(0, 0, 0);
  const sc = { scene, camera, labels: L };
  sc.update = (t, p) => {
    const k = ease(Math.min(1, t / 2.2));
    meshes.forEach((m, i) => { m.rotation.z = t * (.25 + i * .07) * (i % 2 ? -1 : 1); m.scale.setScalar(k); });
    g.rotation.y = Math.sin(t * .3) * .25 + p.x * .2; g.rotation.x = p.y * .15;
    core.material.opacity = .45 + Math.sin(t * 2) * .2;
  };
  return sc;
}

/* ==========================================================
   5. Balance scale
   ========================================================== */
function balance({ host, labels, w, h, opts }) {
  const { scene, camera } = baseScene(w, h, 34);
  const accent = new THREE.Color(opts.color || css('--accent', host));
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xd9b26f, metalness: .9, roughness: .25, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d24, metalness: .6, roughness: .4 });
  const g = new THREE.Group(); scene.add(g); g.position.y = -1.2;
  // base & pillar
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, .35, 64), dark); base.position.y = -3.2; g.add(base);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.14, .2, 6, 32), gold); pillar.position.y = -.2; g.add(pillar);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(.32, 32, 32), gold); knob.position.y = 2.9; g.add(knob);
  const beam = new THREE.Group(); beam.position.y = 2.75; g.add(beam);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(9, .14, .14), gold); beam.add(bar);
  const pans = [];
  const colors = [new THREE.Color(opts.left?.color || '#e8b86d'), new THREE.Color(opts.right?.color || '#4fc3f7')];
  [-1, 1].forEach((s, i) => {
    const hang = new THREE.Group(); hang.position.x = s * 4.3; beam.add(hang);
    const pan = new THREE.Group(); hang.add(pan);
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2; const p0 = new THREE.Vector3(0, 0, 0), p1 = new THREE.Vector3(Math.cos(a) * 1.25, -2.4, Math.sin(a) * 1.25);
      pan.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p0, p1]), new THREE.LineBasicMaterial({ color: 0xd9b26f, transparent: true, opacity: .7 })));
    }
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.1, .22, 64), new THREE.MeshPhysicalMaterial({ color: colors[i], metalness: .5, roughness: .25, clearcoat: 1, emissive: colors[i].clone().multiplyScalar(.3) }));
    dish.position.y = -2.5; pan.add(dish);
    const gl = glowSprite(colors[i], 5); gl.position.y = -2.3; gl.material.opacity = .35; pan.add(gl);
    pans.push({ hang, pan, dish, blocks: [] });
  });
  const L = [];
  if (opts.left) L.push({ el: makeLabel(labels, opts.left.label, { big: true, color: opts.left.color, detail: opts.left.detail, dtitle: opts.left.label }), obj: pans[0].dish, offset: new THREE.Vector3(0, -1.1, 0), delay: .8 });
  if (opts.right) L.push({ el: makeLabel(labels, opts.right.label, { big: true, color: opts.right.color, detail: opts.right.detail, dtitle: opts.right.label }), obj: pans[1].dish, offset: new THREE.Vector3(0, -1.1, 0), delay: 1 });

  let tiltTarget = 0, tilt = 0, vel = 0;
  const sc = { scene, camera, labels: L };
  sc.setTilt = v => { tiltTarget = v; }; // -1 (left heavy) .. 1 (right heavy)
  sc.addBlock = (side, color) => {
    const P = pans[side]; const n = P.blocks.length;
    const c = new THREE.Color(color || colors[side]);
    const b = new THREE.Mesh(new THREE.BoxGeometry(.62, .42, .62), new THREE.MeshPhysicalMaterial({ color: c, metalness: .2, roughness: .3, clearcoat: 1, emissive: c.clone().multiplyScalar(.35) }));
    const slot = n % 4, layer = Math.floor(n / 4);
    b.userData = { tx: (slot % 2 - .5) * .7, tz: (Math.floor(slot / 2) - .5) * .7, ty: -2.17 + layer * .44, y: 4 };
    b.position.set(b.userData.tx, 4, b.userData.tz); P.pan.add(b); P.blocks.push(b);
  };
  sc.reset = () => { pans.forEach(P => { P.blocks.forEach(b => { P.pan.remove(b); b.geometry.dispose(); b.material.dispose(); }); P.blocks = []; }); tiltTarget = 0; };
  camera.position.set(0, 1.2, opts.camZ || 17); camera.lookAt(0, opts.lookY ?? -.4, 0);
  sc.update = (t, p) => {
    // spring physics on the beam
    const target = -tiltTarget * .32;
    vel += (target - tilt) * .045; vel *= .88; tilt += vel;
    beam.rotation.z = tilt;
    pans.forEach(P => { P.hang.rotation.z = -tilt; P.blocks.forEach(b => { b.position.y += (b.userData.ty - b.position.y) * .14; b.rotation.y = Math.sin(t + b.position.x) * .1; }); });
    g.rotation.y = Math.sin(t * .25) * .18 + p.x * .25;
    const k = ease(Math.min(1, t / 1.6)); g.scale.setScalar(.85 + .15 * k);
  };
  return sc;
}

export const SCENES = { oman: omanMap, globe, orbit, rings, balance };
