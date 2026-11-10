// SLED FREE -- an endless downhill sledding game. three.js, fixed isometric orthographic camera, low-res nearest-neighbour render.
(() => {
'use strict';
const TAU = Math.PI * 2, R45 = Math.SQRT1_2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x, lerp = (a, b, t) => a + (b - a) * t, smooth = t => t * t * (3 - 2 * t);
const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// ---------------------------------------------------------------- palette (three families + dark wood)
const PAL = {
  snow0: 0xffffff, snow1: 0xeef2f9, snow2: 0xd6ddf0, ice: 0xb7d2ea, snow3: 0xa7b0dc,      // snow whites, blue-lavender shadows
  pineD: 0x2e4a44, pineL: 0x44695a, bark: 0x6b4c3d, tan: 0xc59c7a, rockD: 0x6a6e82, rockL: 0x9a9fb1,   // evergreen, browns, rock greys
  cherry: 0xc9463f, orange: 0xe2873b, mustard: 0xe3b84b, teal: 0x3d908c,                    // the one warm accent family (+ a little teal)
  wood: 0x4a3429                                                                              // dark wood: sleds, signposts
};
const C = {}, CSS = {};
for (const k in PAL) { const c = new THREE.Color(PAL[k]); C[k] = [c.r, c.g, c.b]; CSS[k] = '#' + PAL[k].toString(16).padStart(6, '0'); }
const ACC = [C.cherry, C.orange, C.mustard, C.teal];

// ---------------------------------------------------------------- constants
const CS = 96;                 // chunk size, metres
const STEP = 1 / 120;          // physics step
const GRAV = 16, GA = 20;      // slope gravity, air gravity
const KN = 0.0105, KT = 0.0045;// drag: sitting, tucked
const VIEW_M = 40;             // metres of screen height
const YETI_AT = 2000;          // the Yeti wakes after this many metres
let RUNSEED = (Math.random() * 1e9) | 0;

// ---------------------------------------------------------------- rng
function hash3(a, b, c) { let h = (a | 0) ^ Math.imul(b | 0, 0x27d4eb2d) ^ Math.imul(c | 0, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
function rng(s) { return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const frand = rng(987654321);  // cosmetic randomness (particles, flakes, npc looks)

// ---------------------------------------------------------------- renderer, scene, camera
const cv = document.getElementById('gl'), hud = document.getElementById('hud'), hx = hud.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
cv.addEventListener('webglcontextlost', e => { e.preventDefault(); document.getElementById('lost').style.display = 'flex'; });
const scene = new THREE.Scene(); scene.background = new THREE.Color(PAL.snow2);
const world = new THREE.Group(); world.rotation.y = Math.PI / 4; scene.add(world);   // game axes: x across the hill, z downhill; the camera sits 45 degrees around
const g2w = (x, y, z, v) => v.set((x + z) * R45, y, (z - x) * R45);
const camera = new THREE.OrthographicCamera(-40, 40, 22.5, -22.5, 1, 600);
const CDIR = new THREE.Vector3(Math.cos(Math.PI / 6) * R45, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6) * R45);   // 30 degrees down, 45 around
camera.position.copy(CDIR).multiplyScalar(250); camera.lookAt(0, 0, 0);
const CR = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), CU = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

const S0 = 0.25, A1 = 0.08, K1 = 110, A2 = 0.045, K2 = 41;
const LG = new THREE.Vector3(-0.7, 0.62, 0.3).normalize();                 // direction to the sun, game axes
const cos0 = LG.y / Math.hypot(1, S0) + LG.z * S0 / Math.hypot(1, S0);
const ambC = [C.snow3[0] / C.snow1[0], C.snow3[1] / C.snow1[1], C.snow3[2] / C.snow1[2]];
const amb = new THREE.AmbientLight(0xffffff, Math.PI); amb.color.setRGB(ambC[0], ambC[1], ambC[2]); scene.add(amb);
const sun = new THREE.DirectionalLight(0xffffff, Math.PI); sun.color.setRGB((1 - ambC[0]) / cos0, (1 - ambC[1]) / cos0, (1 - ambC[2]) / cos0);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
const SH = 66; Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 500 }); sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
scene.add(sun); scene.add(sun.target);
const LW = g2w(LG.x, LG.y, LG.z, new THREE.Vector3());
const LR = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), LW).normalize(), LU = new THREE.Vector3().crossVectors(LW, LR).normalize();

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const TMAT = new THREE.MeshLambertMaterial({ vertexColors: true });

// low-res target + whole-number nearest upscale
let W = 640, H = 360, S = 3, PPM = 8, rt = null;
const HALF_OK = renderer.capabilities.isWebGL2 ? renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float') : renderer.extensions.has('EXT_color_buffer_half_float');
const blitScene = new THREE.Scene(), blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const blitMat = new THREE.ShaderMaterial({
  uniforms: { t: { value: null } }, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader: 'uniform sampler2D t;varying vec2 v;void main(){vec3 c=clamp(texture2D(t,v).rgb,0.,1.);gl_FragColor=vec4(pow(c,vec3(1./2.2)),1.);}'
});
{ const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat); q.frustumCulled = false; blitScene.add(q); }
function resize() {
  const dpr = window.devicePixelRatio || 1, dw = Math.max(1, Math.round(innerWidth * dpr)), dh = Math.max(1, Math.round(innerHeight * dpr));
  S = Math.max(1, Math.round(dh / 360)); W = Math.ceil(dw / S); H = Math.ceil(dh / S); PPM = H / VIEW_M;
  renderer.setSize(W * S, H * S, false);
  cv.style.width = hud.style.width = (W * S / dpr) + 'px'; cv.style.height = hud.style.height = (H * S / dpr) + 'px';
  hud.width = W; hud.height = H; hx.imageSmoothingEnabled = false;
  if (rt) rt.dispose();
  rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: HALF_OK ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true });
  blitMat.uniforms.t.value = rt.texture;
  camera.left = -W / 2 / PPM; camera.right = W / 2 / PPM; camera.top = H / 2 / PPM; camera.bottom = -H / 2 / PPM; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- geometry builder (flat-shaded low-poly, vertex colours, float attributes only)
class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.setT(0, 0, 0, 0, 1); }
  setT(x, y, z, rot, s) { this.tx = x; this.ty = y; this.tz = z; this.cs = Math.cos(rot) * s; this.sn = Math.sin(rot) * s; this.s = s; }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    const { tx, ty, tz, cs, sn, s } = this;
    const AX = ax * cs + az * sn + tx, AY = ay * s + ty, AZ = az * cs - ax * sn + tz;
    const BX = bx * cs + bz * sn + tx, BY = by * s + ty, BZ = bz * cs - bx * sn + tz;
    const CX = cx * cs + cz * sn + tx, CY = cy * s + ty, CZ = cz * cs - cx * sn + tz;
    let nx = (BY - AY) * (CZ - AZ) - (BZ - AZ) * (CY - AY), ny = (BZ - AZ) * (CX - AX) - (BX - AX) * (CZ - AZ), nz = (BX - AX) * (CY - AY) - (BY - AY) * (CX - AX);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(AX, AY, AZ, BX, BY, BZ, CX, CY, CZ); this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.c.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
  }
  quad(a, b, c, d, col) { this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col); this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col); }
  // n-sided tapered prism from y to y+h; the top ring may be offset (ox, oz) to make leaning trunks and branches
  prism(x, y, z, r0, r1, h, n, col, cap, ph = 0, ox = 0, oz = 0, ex = 1, ez = 1) {
    for (let i = 0; i < n; i++) {
      const a0 = ph + i / n * TAU, a1 = ph + (i + 1) / n * TAU, c0 = Math.cos(a0) * ex, s0 = Math.sin(a0) * ez, c1 = Math.cos(a1) * ex, s1 = Math.sin(a1) * ez;
      const b0 = [x + c0 * r0, y, z + s0 * r0], b1 = [x + c1 * r0, y, z + s1 * r0], t0 = [x + ox + c0 * r1, y + h, z + oz + s0 * r1], t1 = [x + ox + c1 * r1, y + h, z + oz + s1 * r1];
      if (r1 > 0) this.quad(b0, t0, t1, b1, col); else this.tri(b0[0], b0[1], b0[2], t0[0], t0[1], t0[2], b1[0], b1[1], b1[2], col);
      if (cap && r1 > 0) this.tri(x + ox, y + h, z + oz, t1[0], t1[1], t1[2], t0[0], t0[1], t0[2], cap);
    }
  }
  box(cx, cy, cz, sx, sy, sz, col, top) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col); this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col); this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top || col); this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
  }
  ball(cx, cy, cz, r, col, sy = 1, sx = 1, sz = 1, seg = 6, rings = 4) {
    const P = (i, j) => { const v = j / rings * Math.PI, u = i / seg * TAU, rr = Math.sin(v) * r; return [cx + Math.cos(u) * rr * sx, cy + Math.cos(v) * r * sy, cz + Math.sin(u) * rr * sz]; };
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (j === 0) this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col);
      else if (j === rings - 1) this.tri(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2], col);
      else this.quad(a, b, c, d, col);
    }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    return g;
  }
  mesh() { const m = new THREE.Mesh(this.geo(), MAT); m.castShadow = true; m.receiveShadow = true; return m; }
}

// ---------------------------------------------------------------- the mountain: a seeded height field
let SEED = 1, TP = null;
const START = { x: 48, z: 20, hut: false };
function setSeed(s) {
  SEED = s | 0; const R = rng(hash3(SEED, 7, 13)); TP = { p1: R() * TAU, p2: R() * TAU, r: [], g1: R() * TAU, g2: R() * TAU };
  const wl = [55, 38, 24, 15], am = [1.2, 0.6, 0.25, 0.1];
  for (let i = 0; i < 4; i++) { const k = TAU / wl[i], a = (R() - 0.5) * 0.9; TP.r.push({ kx: k * Math.cos(a), kz: k * Math.sin(a), a: am[i], p: R() * TAU }); }
  cdata.clear();
}
const baseH = z => -(S0 * z + A1 * K1 * Math.sin(z / K1 + TP.p1) + A2 * K2 * Math.sin(z / K2 + TP.p2));
const slopeAt = z => S0 + A1 * Math.cos(z / K1 + TP.p1) + A2 * Math.cos(z / K2 + TP.p2);
function Hsm(x, z) { let h = baseH(z); for (const r of TP.r) h += r.a * Math.sin(x * r.kx + z * r.kz + r.p); return h; }
const cdata = new Map();
function dataC(cx, cz) { const key = (cx + 32768) * 65536 + (cz + 32768); let d = cdata.get(key); if (!d) { d = genData(cx, cz); cdata.set(key, d); } return d; }
const dataAt = (x, z) => dataC(Math.floor(x / CS), Math.floor(z / CS));
function Hg(x, z) {            // snow surface (rolls + moguls)
  let h = Hsm(x, z); const m = dataAt(x, z).mog;
  for (let i = 0; i < m.length; i++) { const dx = x - m[i].x, dz = z - m[i].z, d2 = (dx * dx + dz * dz) / (m[i].r * m[i].r); if (d2 < 9) h += m[i].h * Math.exp(-d2); }
  return h;
}
function rampAt(x, z) { const rs = dataAt(x, z).ramps; for (let i = 0; i < rs.length; i++) { const r = rs[i], t = (z - r.z) / r.L; if (t >= 0 && t <= 1 && Math.abs(x - r.x) <= r.W / 2) return r.H * Math.pow(t, 1.5); } return 0; }
const Hf = (x, z) => Hg(x, z) + rampAt(x, z);
function iceAt(x, z) { const ic = dataAt(x, z).ice; for (let i = 0; i < ic.length; i++) { const dx = (x - ic[i].x) / ic[i].rx, dz = (z - ic[i].z) / ic[i].rz; if (dx * dx + dz * dz < 1) return 1 - (dx * dx + dz * dz); } return 0; }
function Hmesh(x, z) {         // height of the drawn 1 m terrain mesh (for the runner tracks)
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, b = Hg(i + 1, j), c = Hg(i, j + 1);
  if (fx + fz < 1) { const a = Hg(i, j); return a + (b - a) * fx + (c - a) * fz; }
  const d = Hg(i + 1, j + 1); return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
function segDist(px, pz, s) { const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz; let t = l2 ? ((px - s[0]) * dx + (pz - s[1]) * dz) / l2 : 0; t = clamp(t, 0, 1); return Math.hypot(px - s[0] - dx * t, pz - s[1] - dz * t); }

function genData(cx, cz) {
  const R = rng(hash3(SEED, cx, cz)), ox = cx * CS, oz = cz * CS;
  const D = { cx, cz, ox, oz, obs: [], mog: [], ice: [], ramps: [], gates: [], clear: [], solid: [], hut: null };
  const diff = smooth(clamp((oz - START.z) / 3200, 0, 1));
  const free = (x, z, r) => { for (const s of D.clear) if (segDist(x, z, s) < r + s[4]) return false; return true; };
  const addRamp = (x, z) => { if (!free(x, z + 10, 7)) return; D.ramps.push({ x, z, W: 5, L: 7, H: 1.7 }); D.clear.push([x, z - 20, x, z + 46, 6]); D.solid.push({ x, z: z + 4, r: 3.4 }); };
  const addMog = (x0, z0, n, rx, rz) => {
    if (!free(x0, z0, Math.max(rx, rz))) return; let tries = 0;
    const mine = [];
    while (mine.length < n && tries++ < n * 12) {
      const a = R() * TAU, d = Math.sqrt(R()), x = clamp(x0 + Math.cos(a) * d * rx, ox + 7, ox + CS - 7), z = clamp(z0 + Math.sin(a) * d * rz, oz + 7, oz + CS - 7);
      if (mine.some(m => Math.hypot(m.x - x, m.z - z) < 4.3)) continue; mine.push({ x, z, r: 1.9 + R() * 0.4, h: 0.5 + R() * 0.2 });
    }
    for (const m of mine) D.mog.push(m); D.clear.push([x0, z0 - rz * 0.5, x0, z0 + rz * 0.5, Math.max(rx, rz * 0.6) + 1]);
  };
  const addIce = (x, z, rx, rz) => { if (!free(x, z, Math.max(rx, rz))) return; D.ice.push({ x, z, rx, rz }); D.clear.push([x, z - rz * 0.6, x, z + rz * 0.6, rx * 0.8]); };
  const start = START.hut && cx === Math.floor(START.x / CS) && cz === Math.floor(START.z / CS);
  if (start) {
    D.hut = { x: START.x - 7.5, z: START.z - 2.5 }; D.obs.push({ t: 'hut', x: D.hut.x, z: D.hut.z, r: 3.3, h: 6, rot: 0 });
    D.clear.push([START.x, START.z - 8, START.x, START.z + 62, 9], [D.hut.x, D.hut.z, D.hut.x, D.hut.z, 7]);
  } else {
    const k = R();
    if (k < 0.2) {                                     // slalom run
      const x0 = ox + 30 + R() * 36, ph = R() * TAU, amp = 6 + R() * 3; let lx = 0, lz = 0;
      for (let n = 0; n < 6; n++) {
        const z = oz + 12 + n * 14, x = x0 + amp * Math.sin(n * 1.25 + ph);
        D.gates.push({ x, z, hw: 3.6, col: n & 1, done: 0 });
        D.clear.push(n ? [lx, lz, x, z, 6.5] : [x, z - 8, x, z, 6.5]); lx = x; lz = z;
      }
    } else if (k < 0.4) { const x = ox + 16 + R() * 26; addRamp(x, oz + 22 + R() * 8); addRamp(x + 18 + R() * 30, oz + 28 + R() * 14); }
    else if (k < 0.55) addMog(ox + 30 + R() * 36, oz + 46, 16, 15, 30);
    else if (k < 0.7) { addIce(ox + 26 + R() * 44, oz + 30 + R() * 30, 8 + R() * 4, 12 + R() * 6); }
    else if (k < 0.84) {                               // a fork: a signpost at the tip of a wedge of trees
      const fx = ox + 34 + R() * 28, fz = oz + 10 + R() * 14;
      D.obs.push({ t: 'sign', x: fx, z: fz, r: 0.45, h: 2.4, rot: 0 });
      for (let i = 1; i <= 8; i++) for (let j = -i; j <= i; j += 2) {
        if (R() < 0.18) continue; const x = fx + j * 1.9 + (R() - 0.5) * 1.2, z = fz + 1.5 + i * 4.6 + (R() - 0.5) * 1.5, s = 0.7 + R() * 0.5;
        D.obs.push({ t: 'pine', x, z, s, r: 0.95 * s, h: 6.4 * s, rot: R() * TAU });
      }
      D.clear.push([fx, fz, fx, fz + 40, 3]);
    }
    if (k >= 0.2) {
      if (R() < 0.45) addRamp(ox + 14 + R() * 68, oz + 22 + R() * 22);
      if (R() < 0.35) addMog(ox + 14 + R() * 68, oz + 14 + R() * 68, 6, 7, 9);
      if (R() < 0.25) addIce(ox + 16 + R() * 64, oz + 18 + R() * 60, 5 + R() * 3, 7 + R() * 4);
    }
    if (R() < 0.35) { const x = ox + 6 + R() * 84, z = oz + 6 + R() * 84; if (free(x, z, 2)) D.obs.push({ t: 'snowman', x, z, r: 0.8, h: 2.4, rot: (R() - 0.5) * 1.2 }); }
  }
  const N = Math.round(26 + 50 * diff);
  for (let i = 0, placed = 0; i < N * 4 && placed < N; i++) {
    const x = ox + 1.5 + R() * (CS - 3), z = oz + 1.5 + R() * (CS - 3), q = R(), v = R(), rot = R() * TAU;
    const grove = 0.5 + 0.5 * Math.sin(x * 0.071 + TP.g1) * Math.sin(z * 0.053 + x * 0.019 + TP.g2);
    if (R() > 0.3 + 0.7 * grove) continue;
    if (!free(x, z, 0.5)) continue;
    let o;
    if (q < 0.2) o = { t: 'pine', s: 0.92 + v * 0.2, r: 0, h: 0 };
    else if (q < 0.45) o = { t: 'pine', s: 0.66 + v * 0.16 };
    else if (q < 0.6) o = { t: 'pine', s: 0.42 + v * 0.12 };
    else if (q < 0.72) o = { t: 'bare', s: 0.85 + v * 0.35, r: 0.45, h: 3.6 };
    else if (q < 0.82) o = { t: 'stump', s: 0.9 + v * 0.3, r: 0.55, h: 0.6 };
    else { const s = 0.7 + v * 0.8; o = { t: 'rock', s, r: s * 0.88, h: s * 0.75 }; }
    if (o.t === 'pine') { o.r = 0.95 * o.s; o.h = 6.4 * o.s; }
    if (D.obs.some(p => Math.hypot(p.x - x, p.z - z) < p.r + o.r + 2.2)) continue;
    o.x = x; o.z = z; o.rot = rot; o.v = v; D.obs.push(o); placed++;
  }
  return D;
}
function forObs(x0, x1, z0, z1, fn) {
  for (let cz = Math.floor(z0 / CS); cz <= Math.floor(z1 / CS); cz++) for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) {
    const D = dataC(cx, cz); for (let i = 0; i < D.obs.length; i++) { const o = D.obs[i]; if (o.x >= x0 && o.x <= x1 && o.z >= z0 && o.z <= z1) fn(o); }
  }
}
function forSolid(x, z, pad, fn) {   // trees, rocks... plus the ramp bodies: things walkers and the Yeti must go around
  for (let cz = Math.floor((z - pad) / CS); cz <= Math.floor((z + pad) / CS); cz++) for (let cx = Math.floor((x - pad) / CS); cx <= Math.floor((x + pad) / CS); cx++) {
    const D = dataC(cx, cz); for (let i = 0; i < D.obs.length; i++) fn(D.obs[i]); for (let i = 0; i < D.solid.length; i++) fn(D.solid[i]);
  }
}
function pushOut(e, rad) {           // keep a circle out of every solid thing; returns true if it touched something
  let hit = false;
  forSolid(e.x, e.z, 8, o => { const dx = e.x - o.x, dz = e.z - o.z, rr = o.r + rad, d2 = dx * dx + dz * dz; if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; e.x = o.x + dx / d * rr; e.z = o.z + dz / d * rr; hit = true; } });
  return hit;
}

// ---------------------------------------------------------------- static props
function drawPine(g, s) {
  const hgt = 6.4 * s;
  g.prism(0, 0, 0, 0.26 * s + 0.05, 0.2 * s, hgt * 0.22, 5, C.bark);
  for (let i = 0; i < 3; i++) {
    const y0 = hgt * (0.14 + i * 0.26), r = hgt * 0.3 * (1 - i * 0.26), h = hgt * (0.4 - i * 0.03);
    g.prism(0, y0, 0, r, 0, h, 6, i === 1 ? C.pineL : C.pineD, null, i * 0.5);
    g.prism(0, y0 + h * 0.36, 0, r * 0.72, 0, h * 0.66, 6, i === 2 ? C.snow0 : C.snow1, null, i * 0.5);   // the snow load
  }
}
function drawBare(g, s, v) {
  const h = 3.4 * s, lx = (v - 0.5) * 0.5;
  g.prism(0, 0, 0, 0.2, 0.09, h, 5, C.bark, null, 0, lx, 0.1);
  const br = [[0.42, 1.1, 0.5, 0.9], [0.55, -1.0, 0.2, 0.8], [0.68, 0.5, -0.8, 0.7], [0.78, -0.6, 0.6, 0.6], [0.6, 0.2, 1.0, 0.6]];
  for (const b of br) { const y = h * b[0], bx = lx * b[0], l = b[3] * s; g.prism(bx, y, 0.1 * b[0], 0.07, 0.03, l, 4, C.wood, null, 0, b[1] * l, b[2] * l); g.ball(bx + b[1] * l, y + l + 0.05, 0.1 * b[0] + b[2] * l, 0.15, C.snow1, 0.7, 1, 1, 5, 3); }
  g.ball(lx, h + 0.05, 0.1, 0.16, C.snow1, 0.7, 1, 1, 5, 3);
}
function drawStump(g, s) { g.prism(0, 0, 0, 0.5 * s, 0.4 * s, 0.6, 6, C.bark, C.tan, 0.3); g.ball(0.12, 0.62, -0.1, 0.3 * s, C.snow1, 0.5, 1, 1, 5, 3); }
function drawRock(g, s, v) {
  const ph = v * TAU, ex = 1 + (v - 0.5) * 0.4;
  g.prism(0, -0.3, 0, s * 1.0, s * 0.82, s * 0.5 + 0.3, 6, C.rockD, null, ph, 0, 0, ex, 1 / ex);
  g.prism(0, s * 0.5, 0, s * 0.82, s * 0.42, s * 0.34, 6, C.rockL, C.snow1, ph, s * 0.08, -s * 0.05, ex, 1 / ex);
  g.prism(0, s * 0.5, 0, s * 0.6, s * 0.36, s * 0.38, 6, C.snow1, C.snow0, ph + 0.5, -s * 0.1, -s * 0.12, ex, 1 / ex);
}
function drawSnowman(g) {
  g.ball(0, 0.5, 0, 0.66, C.snow2); g.ball(0, 1.32, 0, 0.47, C.snow2); g.ball(0, 1.95, 0, 0.33, C.snow1);
  g.prism(0, 1.93, 0.28, 0.07, 0, 0.01, 4, C.orange, null, 0, 0, 0.32);       // carrot nose points downhill
  g.prism(0, 1.62, 0, 0.36, 0.33, 0.12, 6, C.cherry, C.cherry); g.box(0.2, 1.42, 0.3, 0.14, 0.34, 0.08, C.cherry);
  g.prism(0, 2.2, 0, 0.36, 0.36, 0.05, 6, C.wood, C.wood); g.prism(0, 2.25, 0, 0.23, 0.22, 0.32, 6, C.wood, C.wood);
  g.prism(0.42, 1.4, 0, 0.045, 0.03, 0.4, 4, C.wood, null, 0, 0.55, 0); g.prism(-0.42, 1.4, 0, 0.045, 0.03, 0.4, 4, C.wood, null, 0, -0.55, 0);
  g.box(-0.12, 2.02, 0.29, 0.07, 0.07, 0.05, C.wood); g.box(0.12, 2.02, 0.29, 0.07, 0.07, 0.05, C.wood);
}
function drawSign(g) {
  g.box(0, 1.2, 0, 0.18, 2.4, 0.18, C.wood); g.box(0, 2.44, 0, 0.3, 0.1, 0.3, C.snow1);
  const arrow = (y, d, col) => {      // a pointed board, no words on it
    const z = 0.12, a = [-0.15 * d, y - 0.2, z], b = [0.95 * d, y - 0.2 - 0.18, z], c = [1.35 * d, y - 0.02 - 0.26, z], e = [0.95 * d, y + 0.2 - 0.18, z], f = [-0.15 * d, y + 0.2, z];
    g.tri(a[0], a[1], a[2], b[0], b[1], b[2], e[0], e[1], e[2], col); g.tri(a[0], a[1], a[2], e[0], e[1], e[2], f[0], f[1], f[2], col); g.tri(b[0], b[1], b[2], c[0], c[1], c[2], e[0], e[1], e[2], col);
    g.box(0.4 * d, y + 0.16, z, 1.0, 0.07, 0.1, C.snow1);
  };
  arrow(2.0, -1, C.tan); arrow(1.5, 1, C.mustard);
}
function drawFlag(g, col) { g.prism(0, 0, 0, 0.07, 0.05, 2.5, 4, C.wood); g.tri(0, 2.5, 0, 0, 1.6, 0, 1.15, 2.05, 0, col); g.tri(0, 2.5, 0.03, 1.15, 2.05, 0.03, 0, 1.6, 0.03, col); }
function drawHut(g) {
  g.box(0, 1.3, 0, 4.6, 2.6, 3.8, C.tan); g.box(0, 0.25, 0, 4.7, 0.5, 3.9, C.bark);
  g.box(0.3, 1.0, 1.92, 0.9, 1.9, 0.08, C.wood); g.box(-1.2, 1.6, 1.92, 0.8, 0.7, 0.08, C.mustard);        // door and a lit window, downhill side
  const e = 2.75, hw = 2.35, rz = 0, ry = 4.2, ey = 2.5;                                                   // snowy pitched roof, ridge along x
  g.quad([-e, ey, 2.5], [e, ey, 2.5], [e, ry, rz], [-e, ry, rz], C.snow1); g.quad([e, ey, -2.5], [-e, ey, -2.5], [-e, ry, rz], [e, ry, rz], C.snow1);
  g.quad([-e, ey - 0.18, 2.5], [e, ey - 0.18, 2.5], [e, ey, 2.5], [-e, ey, 2.5], C.wood); g.quad([e, ey - 0.18, -2.5], [-e, ey - 0.18, -2.5], [-e, ey, -2.5], [e, ey, -2.5], C.wood);
  for (const s of [-1, 1]) { g.tri(s * hw, 2.6, 1.9, s * hw, 2.6, -1.9, s * hw, 4.05, 0, C.bark); g.tri(s * e, ey, 2.5, s * e, ey, -2.5, s * e, ry, 0, C.wood); }
  g.box(1.4, 4.0, -0.9, 0.6, 1.3, 0.6, C.rockD, C.snow0);
  g.box(-3.3, 0.5, 1.4, 0.16, 1.4, 0.16, C.wood); g.box(-3.3, 1.2, 1.4, 0.7, 0.34, 0.06, C.cherry);       // a little marker post by the door
}
function drawRamp(g, r, ox, y0, oz) {
  const n = 6, L = [], Rr = [];
  for (let k = 0; k <= n; k++) { const z = r.z + r.L * k / n, hh = r.H * Math.pow(k / n, 1.5) + 0.06; for (const [arr, x] of [[L, r.x - r.W / 2], [Rr, r.x + r.W / 2]]) { const gy = Hg(x, z) - y0; arr.push([x - ox, gy - 0.5, z - oz, gy + hh]); } }
  for (let k = 0; k < n; k++) {
    const a = L[k], b = L[k + 1], c = Rr[k + 1], d = Rr[k];
    g.quad([a[0], a[3], a[2]], [b[0], b[3], b[2]], [c[0], c[3], c[2]], [d[0], d[3], d[2]], k & 1 ? C.snow2 : C.snow1);        // packed snow on top
    const e = 0.34, col = k & 1 ? C.bark : C.tan;                                                                                        // plank sides, standing a little proud of the snow as rails
    g.quad([a[0], a[1], a[2]], [a[0], a[3] + e, a[2]], [b[0], b[3] + e, b[2]], [b[0], b[1], b[2]], col); g.quad([d[0], d[1], d[2]], [c[0], c[1], c[2]], [c[0], c[3] + e, c[2]], [d[0], d[3] + e, d[2]], col);
    g.quad([a[0] + 0.22, a[3], a[2]], [a[0] + 0.22, a[3] + e, a[2]], [b[0] + 0.22, b[3] + e, b[2]], [b[0] + 0.22, b[3], b[2]], col); g.quad([d[0] - 0.22, d[3], d[2]], [c[0] - 0.22, c[3], c[2]], [c[0] - 0.22, c[3] + e, c[2]], [d[0] - 0.22, d[3] + e, d[2]], col);
    g.quad([a[0], a[3] + e, a[2]], [a[0] + 0.22, a[3] + e, a[2]], [b[0] + 0.22, b[3] + e, b[2]], [b[0], b[3] + e, b[2]], C.wood); g.quad([d[0] - 0.22, d[3] + e, d[2]], [d[0], d[3] + e, d[2]], [c[0], c[3] + e, c[2]], [c[0] - 0.22, c[3] + e, c[2]], C.wood);
  }
  const a = L[n], d = Rr[n], zz = a[2] + 0.02;                                                                                         // the lip end: planks and posts
  for (let i = 0; i < 5; i++) { const x0 = lerp(a[0], d[0], i / 5), x1 = lerp(a[0], d[0], (i + 1) / 5), g0 = lerp(a[1], d[1], i / 5), g1 = lerp(a[1], d[1], (i + 1) / 5), t0 = lerp(a[3], d[3], i / 5), t1 = lerp(a[3], d[3], (i + 1) / 5); g.quad([x0, g0, zz], [x1, g1, zz], [x1, t1 - 0.1, zz], [x0, t0 - 0.1, zz], i & 1 ? C.tan : C.bark); }
  g.box(a[0], (a[1] + a[3]) / 2 + 0.2, a[2], 0.3, a[3] - a[1] + 0.5, 0.3, C.wood, C.snow1); g.box(d[0], (d[1] + d[3]) / 2 + 0.2, d[2], 0.3, d[3] - d[1] + 0.5, 0.3, C.wood, C.snow1);
}
function drawObs(g, o) {
  switch (o.t) { case 'pine': drawPine(g, o.s); break; case 'bare': drawBare(g, o.s, o.v); break; case 'stump': drawStump(g, o.s); break; case 'rock': drawRock(g, o.s, o.v); break;
    case 'snowman': drawSnowman(g); break; case 'sign': drawSign(g); break; case 'hut': drawHut(g); break; }
}

// ---------------------------------------------------------------- chunks: built ahead, removed behind
const chunks = new Map();
function buildChunk(cx, cz) {
  const D = dataC(cx, cz), ox = D.ox, oz = D.oz, y0 = baseH(oz + CS / 2), n = CS + 1, m = n + 2;
  const hs = new Float32Array(m * m);
  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) hs[(j + 1) * m + i + 1] = Hg(ox + i, oz + j) - y0;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), idx = new Uint16Array(CS * CS * 6);
  for (let j = 0, v = 0; j < n; j++) for (let i = 0; i < n; i++, v += 3) {
    const q = (j + 1) * m + i + 1, x = ox + i, z = oz + j;
    pos[v] = i; pos[v + 1] = hs[q]; pos[v + 2] = j;
    let nx = -(hs[q + 1] - hs[q - 1]) / 2, nz = -(hs[q + m] - hs[q - m]) / 2; const l = Math.hypot(nx, 1, nz); nor[v] = nx / l; nor[v + 1] = 1 / l; nor[v + 2] = nz / l;
    const t = 0.22 * (0.5 + 0.5 * Math.sin(x * 0.031 + z * 0.017 + TP.g1) * Math.sin(z * 0.023 - x * 0.011 + TP.g2));
    let r = lerp(C.snow1[0], C.snow2[0], t), g = lerp(C.snow1[1], C.snow2[1], t), b = lerp(C.snow1[2], C.snow2[2], t);
    const ic = iceAt(x, z);
    if (ic > 0) { const f = Math.min(1, ic * 5), streak = ic > 0.55 ? 0.82 : 1; r = lerp(r, C.ice[0], f * streak); g = lerp(g, C.ice[1], f * streak); b = lerp(b, C.ice[2], f * streak); }
    col[v] = r; col[v + 1] = g; col[v + 2] = b;
  }
  for (let j = 0, k = 0; j < CS; j++) for (let i = 0; i < CS; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d; }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); tg.setAttribute('color', new THREE.BufferAttribute(col, 3)); tg.setIndex(new THREE.BufferAttribute(idx, 1));
  const tm = new THREE.Mesh(tg, TMAT); tm.position.set(ox, y0, oz); tm.receiveShadow = true; tm.matrixAutoUpdate = false; tm.updateMatrix(); world.add(tm);
  const gb = new GB();
  for (const o of D.obs) { gb.setT(o.x - ox, Hg(o.x, o.z) - y0 - 0.1, o.z - oz, o.t === 'hut' ? -0.6 : o.rot, 1); drawObs(gb, o); }
  for (const g of D.gates) for (const s of [-1, 1]) { const x = g.x + s * g.hw; gb.setT(x - ox, Hg(x, g.z) - y0 - 0.1, g.z - oz, 0, 1); drawFlag(gb, g.col ? C.teal : C.cherry); }
  gb.setT(0, 0, 0, 0, 1); for (const r of D.ramps) drawRamp(gb, r, ox, y0, oz);
  let pm = null;
  if (gb.p.length) { pm = gb.mesh(); pm.position.set(ox, y0, oz); pm.matrixAutoUpdate = false; pm.updateMatrix(); world.add(pm); }
  return { tm, pm };
}
function dropChunk(c) { world.remove(c.tm); c.tm.geometry.dispose(); if (c.pm) { world.remove(c.pm); c.pm.geometry.dispose(); } }
function ensureChunks(tx, tz, all) {
  const x0 = Math.floor((tx - 62) / CS), x1 = Math.floor((tx + 62) / CS), z0 = Math.floor((tz - 56) / CS), z1 = Math.floor((tz + 66) / CS), z2 = Math.floor((tz + 150) / CS);
  let budget = 1;
  for (let cz = z0; cz <= z2; cz++) for (let cx = x0; cx <= x1; cx++) {
    const key = cx + ',' + cz; if (chunks.has(key)) continue;
    if (cz <= z1 || all || budget-- > 0) chunks.set(key, Object.assign(buildChunk(cx, cz), { cx, cz }));
  }
  for (const [key, c] of chunks) if (c.cx < x0 - 1 || c.cx > x1 + 1 || c.cz < z0 - 1 || c.cz > z2 + 1) { dropChunk(c); chunks.delete(key); }
  if (cdata.size > 400) for (const [key, d] of cdata) if (d.cz < z0 - 2 || Math.abs(d.cx - x0) > 6) cdata.delete(key);
}
function clearChunks() { for (const c of chunks.values()) dropChunk(c); chunks.clear(); }

// ---------------------------------------------------------------- figures: small, shaped, jointed
const mk = b => b.mesh();
function makePerson(o) {
  const g = new THREE.Group(), hip = new THREE.Group(), torso = new THREE.Group(); g.add(hip); hip.add(torso);
  let b = new GB();
  b.prism(0, -0.04, 0, 0.21, 0.24, 0.32, 6, o.coat); b.prism(0, 0.28, 0, 0.24, 0.12, 0.3, 6, o.coat, o.coat);
  b.prism(0, 0.55, 0, 0.15, 0.14, 0.1, 6, o.scarf, o.scarf); b.box(0.1, 0.42, 0.17, 0.09, 0.28, 0.06, o.scarf);
  torso.add(mk(b));
  b = new GB(); b.ball(0, 0.8, 0, 0.17, C.tan); b.prism(0, 0.84, 0, 0.185, 0.1, 0.2, 6, o.hat, o.hat); b.ball(0, 1.07, 0, 0.07, o.scarf, 1, 1, 1, 4, 3);
  const head = mk(b); torso.add(head);
  const limb = (parent, x, y, len, r0, r1, col, end) => {
    const j = new THREE.Group(); j.position.set(x, y, 0); const q = new GB(); q.prism(0, -len, 0, r0, r1, len, 5, col);
    if (end === 'mitt') q.ball(0, -len - 0.03, 0, r0 + 0.025, C.wood, 1, 1, 1, 4, 3); else q.box(0, -len - 0.03, 0.06, 0.15, 0.11, 0.27, C.wood);
    j.add(mk(q)); parent.add(j); return j;
  };
  const aL = limb(torso, -0.28, 0.5, 0.4, 0.055, 0.075, o.coat, 'mitt'), aR = limb(torso, 0.28, 0.5, 0.4, 0.055, 0.075, o.coat, 'mitt');
  const lL = limb(hip, -0.11, 0, 0.5, 0.075, 0.1, o.pants, 'boot'), lR = limb(hip, 0.11, 0, 0.5, 0.075, 0.1, o.pants, 'boot');
  g.scale.setScalar(o.scale || 1.3);
  return { g, hip, torso, head, aL, aR, lL, lR };
}
function pose(p, hipY, hipRx, torsoRx, lL, lR, aL, aR, armZ = 0.15, legZ = 0) {
  p.hip.position.y = hipY; p.hip.rotation.x = hipRx; p.torso.rotation.x = torsoRx;
  p.lL.rotation.set(lL, 0, -legZ); p.lR.rotation.set(lR, 0, legZ); p.aL.rotation.set(aL, 0, -armZ); p.aR.rotation.set(aR, 0, armZ);
}
const poseSit = (p, lean = -0.15, arm = -0.6) => pose(p, 0.42, 0, lean, -1.45, -1.45, arm, arm, 0.2, 0.08);
const poseStand = p => pose(p, 0.63, 0, 0, 0, 0, 0, 0);
function makeSled(col, slat) {
  const b = new GB();
  for (const s of [-1, 1]) { b.box(s * 0.26, 0.04, 0, 0.07, 0.08, 1.5, C.wood); b.box(s * 0.26, 0.13, 0.78, 0.07, 0.2, 0.1, C.wood); b.box(s * 0.26, 0.17, 0.35, 0.06, 0.2, 0.06, C.wood); b.box(s * 0.26, 0.17, -0.4, 0.06, 0.2, 0.06, C.wood); }
  b.box(0, 0.29, -0.05, 0.66, 0.07, 1.25, col); b.box(0, 0.33, -0.05, 0.14, 0.02, 1.25, slat); b.box(0, 0.25, 0.8, 0.6, 0.06, 0.08, C.wood);
  const m = mk(b); m.scale.setScalar(1.2); return m;
}
function makeSaucer(col) { const b = new GB(); b.prism(0, 0.02, 0, 0.5, 0.72, 0.16, 8, col, null); b.prism(0, 0.06, 0, 0.5, 0.5, 0.02, 8, C.wood, C.wood); return mk(b); }
function makeBoard(col) { const b = new GB(); b.box(0, 0.06, 0, 0.34, 0.07, 1.6, col); b.box(0, 0.1, 0.78, 0.3, 0.07, 0.14, col); b.box(0, 0.1, -0.78, 0.3, 0.07, 0.14, col); return mk(b); }
function makeDog() {
  const g = new THREE.Group(); let b = new GB();
  b.ball(0, 0.5, 0, 0.23, C.bark, 1, 1, 2.1, 6, 4); b.ball(0, 0.72, 0.52, 0.19, C.tan, 1, 1, 1.1, 5, 4); b.box(0, 0.67, 0.74, 0.14, 0.12, 0.2, C.bark); b.box(0, 0.71, 0.85, 0.07, 0.06, 0.05, C.wood);
  b.prism(-0.12, 0.84, 0.45, 0.07, 0.02, 0.14, 4, C.wood); b.prism(0.12, 0.84, 0.45, 0.07, 0.02, 0.14, 4, C.wood); b.prism(0, 0.55, -0.45, 0.06, 0.03, 0.3, 4, C.tan, null, 0, 0, -0.2);
  b.prism(0, 0.5, 0.3, 0.16, 0.16, 0.06, 5, C.cherry, C.cherry);
  g.add(mk(b)); const legs = [];
  for (const [x, z] of [[-0.13, 0.33], [0.13, 0.33], [-0.13, -0.33], [0.13, -0.33]]) { const j = new THREE.Group(); j.position.set(x, 0.4, z); const q = new GB(); q.prism(0, -0.4, 0, 0.05, 0.07, 0.4, 4, C.tan); j.add(mk(q)); g.add(j); legs.push(j); }
  return { g, legs };
}
function makeYeti() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  let b = new GB();
  b.ball(0, 2.05, 0, 1.12, C.snow3, 1.22, 1, 0.88, 7, 5); b.ball(0, 3.5, 0.08, 0.66, C.snow2, 1, 1, 0.95, 6, 4);
  b.ball(0, 3.46, 0.52, 0.4, C.rockD, 0.9, 1, 0.45, 6, 4);                                                       // face
  b.box(-0.16, 3.56, 0.7, 0.1, 0.1, 0.05, C.snow0); b.box(0.16, 3.56, 0.7, 0.1, 0.1, 0.05, C.snow0); b.box(0, 3.3, 0.7, 0.3, 0.1, 0.05, C.cherry);
  b.prism(-0.34, 3.98, 0.05, 0.11, 0, 0.3, 4, C.rockL); b.prism(0.34, 3.98, 0.05, 0.11, 0, 0.3, 4, C.rockL);
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; b.prism(Math.cos(a) * 1.02, 1.55, Math.sin(a) * 0.9, 0.3, 0, -0.75, 4, i & 1 ? C.snow2 : C.ice, null, a); b.prism(Math.cos(a + 0.3) * 0.86, 2.75, Math.sin(a + 0.3) * 0.76, 0.26, 0, -0.6, 4, i & 1 ? C.ice : C.snow2, null, a); }   // shaggy tufts
  body.add(mk(b));
  const limb = (x, y, len, r, foot) => {
    const j = new THREE.Group(); j.position.set(x, y, 0); const q = new GB(); q.prism(0, -len, 0, r * 1.12, r, len, 6, C.snow3);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; q.prism(Math.cos(a) * r, -len * 0.45, Math.sin(a) * r, 0.2, 0, -0.5, 4, i & 1 ? C.snow2 : C.ice); }
    if (foot) q.box(0, -len - 0.12, 0.18, r * 2.3, 0.3, r * 3.2, C.rockL); else q.ball(0, -len - 0.2, 0, r * 1.25, C.rockL, 1, 1, 1, 5, 3);
    j.add(mk(q)); return j;
  };
  const aL = limb(-1.22, 2.9, 1.7, 0.36, false), aR = limb(1.22, 2.9, 1.7, 0.36, false); body.add(aL); body.add(aR);
  const lL = limb(-0.52, 1.25, 0.95, 0.42, true), lR = limb(0.52, 1.25, 0.95, 0.42, true); g.add(lL); g.add(lR);
  return { g, body, aL, aR, lL, lR };
}
const place = (g, x, y, z, yaw, pitch, roll) => { g.position.set(x, y, z); g.rotation.set(pitch || 0, yaw || 0, roll || 0, 'YXZ'); };

// ---------------------------------------------------------------- particles (snow spray and puffs), runner tracks
const NP = 420, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pLife = new Float32Array(NP); let pNext = 0;
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true })); pts.frustumCulled = false; world.add(pts);
function spray(x, y, z, n, vx, vy, vz, spread, life) {
  for (let i = 0; i < n; i++) {
    const k = pNext; pNext = (pNext + 1) % NP; const c = frand() < 0.5 ? C.snow0 : frand() < 0.5 ? C.snow2 : C.snow3;
    pPos[k * 3] = x + (frand() - 0.5) * 0.6; pPos[k * 3 + 1] = y + frand() * 0.3; pPos[k * 3 + 2] = z + (frand() - 0.5) * 0.6;
    pVel[k * 3] = vx + (frand() - 0.5) * spread; pVel[k * 3 + 1] = vy * (0.5 + frand()); pVel[k * 3 + 2] = vz + (frand() - 0.5) * spread;
    pCol[k * 3] = c[0]; pCol[k * 3 + 1] = c[1]; pCol[k * 3 + 2] = c[2]; pLife[k] = life * (0.5 + frand() * 0.8);
  }
}
function stepParticles(dt) {
  for (let k = 0; k < NP; k++) {
    if (pLife[k] <= 0) continue; pLife[k] -= dt;
    if (pLife[k] <= 0) { pPos[k * 3 + 1] = 1e6; continue; }
    pVel[k * 3 + 1] -= 9 * dt; pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
function clearParticles() { for (let k = 0; k < NP; k++) { pLife[k] = 0; pPos[k * 3 + 1] = 1e6; } }

const NT = 900, tPos = new Float32Array(NT * 36), tCol = new Float32Array(NT * 48), tBorn = new Float32Array(NT).fill(-1e9); let tNext = 0, tLast = null;
const TRACK_LIFE = 26;
const tGeo = new THREE.BufferGeometry(); tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3)); tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 4));
const trackMesh = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
trackMesh.frustumCulled = false; world.add(trackMesh);
function trackPoint(x, z, th, t) {       // lay a segment of the twin runner tracks behind the sled
  if (tLast && Math.hypot(x - tLast.x, z - tLast.z) < 0.5) return;
  const cx = Math.cos(th), sx = Math.sin(th), cur = { x, z, p: [] };
  for (const s of [-1, 1]) for (const w of [-0.1, 0.1]) { const px = x + cx * (s * 0.32 + w), pz = z - sx * (s * 0.32 + w); cur.p.push([px, Hmesh(px, pz) + 0.035, pz]); }
  if (tLast && Math.hypot(x - tLast.x, z - tLast.z) < 2.5) {
    const k = tNext; tNext = (tNext + 1) % NT; tBorn[k] = t; let o = k * 36;
    for (let r = 0; r < 2; r++) { const a = tLast.p[r * 2], b = tLast.p[r * 2 + 1], c = cur.p[r * 2 + 1], d = cur.p[r * 2]; for (const v of [a, b, c, a, c, d]) { tPos[o++] = v[0]; tPos[o++] = v[1]; tPos[o++] = v[2]; } }
    for (let i = 0; i < 12; i++) { tCol[k * 48 + i * 4] = C.snow3[0] * 0.92; tCol[k * 48 + i * 4 + 1] = C.snow3[1] * 0.92; tCol[k * 48 + i * 4 + 2] = C.snow3[2]; }
    tGeo.attributes.position.needsUpdate = true;
  }
  tLast = cur;
}
function fadeTracks(t) { for (let k = 0; k < NT; k++) { const a = clamp(1 - (t - tBorn[k]) / TRACK_LIFE, 0, 1) * 0.85; for (let i = 0; i < 12; i++) tCol[k * 48 + i * 4 + 3] = a; } tGeo.attributes.color.needsUpdate = true; }
function clearTracks() { tBorn.fill(-1e9); tPos.fill(0); tLast = null; tGeo.attributes.position.needsUpdate = true; }

// ---------------------------------------------------------------- sound: all synthesised
const AU = { ctx: null, mute: false };
function auInit() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = AU.ctx = new AC(), m = AU.master = c.createGain(); m.gain.value = AU.mute ? 0 : 0.8; m.connect(c.destination);
    const nb = AU.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = (type, f, q) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(m); s.start(); return { fl, g }; };
    AU.hiss = loop('bandpass', 1800, 0.8); AU.crunch = loop('highpass', 2600, 0.5); AU.air = loop('bandpass', 520, 1.4); AU.wind = loop('lowpass', 420, 0.3);
    AU.wind.g.gain.value = 0.05;
  } catch (e) { AU.ctx = null; }
}
function burst(f, q, dur, vol, type, delay = 0, f2 = 0) {
  const c = AU.ctx; if (!c) return; const t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = AU.noise; s.loop = true;
  const fl = c.createBiquadFilter(); fl.type = type || 'bandpass'; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(AU.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(type, f0, f1, dur, vol, delay = 0) {
  const c = AU.ctx; if (!c) return; const t = c.currentTime + delay, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(AU.master); o.start(t); o.stop(t + dur + 0.05);
}
const sfxThump = v => { tone('sine', 110, 42, 0.22, 0.5 * v); burst(300, 0.7, 0.16, 0.25 * v, 'lowpass'); };
const sfxCrash = () => { burst(900, 0.6, 0.45, 0.55, 'lowpass', 0, 200); for (let i = 0; i < 5; i++) tone('square', 180 + Math.random() * 500, 90 + Math.random() * 80, 0.07, 0.13, 0.03 + i * 0.07 + Math.random() * 0.03); burst(2400, 0.5, 0.7, 0.2, 'highpass', 0.1); };
const sfxChime = () => { tone('sine', 1319, 1319, 0.35, 0.22); tone('sine', 1976, 1976, 0.5, 0.18, 0.09); tone('triangle', 2637, 2637, 0.4, 0.07, 0.09); };
const sfxMiss = () => tone('triangle', 330, 220, 0.2, 0.16);
const sfxStomp = () => { tone('sine', 80, 32, 0.3, 0.7); burst(180, 0.6, 0.25, 0.4, 'lowpass'); };
function sfxRoar() {
  const c = AU.ctx; if (!c) return; const t = c.currentTime, g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.linearRampToValueAtTime(1100, t + 0.5); lp.frequency.linearRampToValueAtTime(380, t + 1.7);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7, t + 0.15); g.gain.setValueAtTime(0.7, t + 1.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
  const trem = c.createOscillator(), tg = c.createGain(); trem.frequency.value = 23; tg.gain.value = 0.3; trem.connect(tg); tg.connect(g.gain); trem.start(t); trem.stop(t + 2);
  for (const [mul, type] of [[1, 'sawtooth'], [1.51, 'sawtooth'], [0.5, 'square']]) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(70 * mul, t); o.frequency.linearRampToValueAtTime(128 * mul, t + 0.45); o.frequency.linearRampToValueAtTime(58 * mul, t + 1.8); const og = c.createGain(); og.gain.value = 0.33; o.connect(og); og.connect(lp); o.start(t); o.stop(t + 2); }
  lp.connect(g); g.connect(AU.master); burst(700, 0.4, 1.6, 0.3, 'lowpass', 0.05, 250);
}
function auFrame() {
  const c = AU.ctx; if (!c) return; const t = c.currentTime, p = P, riding = p.phase === 'ride' && G.mode !== 'over', sp = Math.hypot(p.vx, p.vz), gnd = riding && !p.air;
  AU.hiss.fl.frequency.setTargetAtTime(900 + sp * 110, t, 0.08); AU.hiss.g.gain.setTargetAtTime(gnd ? Math.min(0.2, sp * 0.011) * (p.ice ? 0.4 : 1) : 0, t, 0.05);
  AU.crunch.g.gain.setTargetAtTime(gnd ? Math.min(0.22, Math.abs(p.slip) * 0.06 + (p.brakeOn ? sp * 0.012 : 0)) : 0, t, 0.04);
  AU.air.fl.frequency.setTargetAtTime(380 + sp * 22, t, 0.1); AU.air.g.gain.setTargetAtTime(riding && p.air && p.airT > 0.1 ? 0.2 : 0, t, 0.08);
  AU.wind.fl.frequency.setTargetAtTime(330 + 120 * Math.sin(G.t * 0.4) + sp * 9, t, 0.3); AU.wind.g.gain.setTargetAtTime(0.045 + 0.02 * Math.sin(G.t * 0.23) + sp * 0.0012, t, 0.3);
}

// ---------------------------------------------------------------- game state
const G = { mode: 'attract', t: 0, pop: null, warn: 0, warnSide: 1, best: 0, overT: 0, frame: 0 };
try { G.best = +(localStorage.getItem('sledfree.best') || 0) || 0; } catch (e) { G.best = 0; }
const P = { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, vyg: 0, th: 0, pth: 0, w: 0, spin: 0, pspin: 0, reach: 0, reachT: 0, air: false, airT: 0, phase: 'ride', pt: 0, lean: 0, slip: 0, ice: 0, grace: 0, brakeOn: false, tuckOn: false, dist: 0, style: 0, hopT: 1, hx: 0, hz: 0 };
const RD = { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vz: 0, roll: 0, yaw: 0 };   // the rider, while off the sled
const SD = { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vz: 0, flip: 0, yaw: 0 };   // the sled, while riderless
const rider = makePerson({ coat: C.orange, hat: C.mustard, scarf: C.teal, pants: C.rockD });
const sledG = new THREE.Group(); sledG.add(makeSled(C.cherry, C.mustard)); world.add(sledG); world.add(rider.g);
const NPCS = [];
const YETI = Object.assign(makeYeti(), { st: 'off', x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, th: 0, v: 0, t: 0, nextAt: YETI_AT, run: 0, chaseT: 0 });
YETI.g.visible = false; world.add(YETI.g);
const pop = (text, col) => { G.pop = { text, t: 0, col: col || CSS.cherry }; };

function resetRun(attract) {
  for (const n of NPCS) world.remove(n.g); NPCS.length = 0; clearChunks(); clearTracks(); clearParticles();
  START.hut = !attract; setSeed(attract ? (RUNSEED ^ 0x5f3759df) : RUNSEED);
  Object.assign(P, { x: START.x, z: attract ? 900 : START.z, vx: 0, vy: 0, vz: attract ? 9 : 0, vyg: 0, th: 0, w: 0, spin: 0, pspin: 0, reach: 0, air: false, airT: 0, phase: attract ? 'ride' : 'push', pt: 0, lean: 0, slip: 0, grace: 0, dist: 0, style: 0 });
  if (attract) { let tries = 0; while (tries++ < 40 && pushOut(P, 4)) { } }
  P.y = Hf(P.x, P.z); P.px = P.x; P.py = P.y; P.pz = P.z; P.pth = 0;
  Object.assign(YETI, { st: 'off', nextAt: YETI_AT, chaseT: 0 }); YETI.g.visible = false;
  G.mode = attract ? 'attract' : 'play'; G.pop = null; G.warn = 0; G.overT = 0; npcTimer = 2; AI.next = 0; cam.init = false;
  rider.g.visible = sledG.visible = true;
}
function startRun() { RUNSEED = (RUNSEED * 1103515245 + 12345 + ((Math.random() * 1e6) | 0)) | 0; resetRun(false); }

// ---------------------------------------------------------------- input: keyboard, gamepad, touch
const keys = Object.create(null), touchK = Object.create(null); let jumpLatch = false, padJump = false, padStart = false;
function onStartKey() { if (G.mode === 'attract' || (G.mode === 'over' && G.overT > 0.6)) startRun(); }
window.addEventListener('keydown', e => {
  auInit(); const k = e.code;
  if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'Space') e.preventDefault();
  if (e.repeat) return; keys[k] = true;
  if (k === 'Space') jumpLatch = true;
  if (k === 'Enter' || k === 'NumpadEnter') onStartKey();
  if (k === 'KeyR' && G.mode !== 'attract') startRun();
  if (k === 'KeyM') { AU.mute = !AU.mute; if (AU.master) AU.master.gain.value = AU.mute ? 0 : 0.8; pop(AU.mute ? 'SOUND OFF' : 'SOUND ON', CSS.wood); }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
{
  const tEl = document.getElementById('touch'), map = { bl: 'L', br: 'R', bt: 'T', bb: 'B', bj: 'J' };
  window.addEventListener('touchstart', e => { auInit(); tEl.style.display = 'block'; if (!(e.target && e.target.id in map)) onStartKey(); }, { passive: true });
  window.addEventListener('mousedown', () => { auInit(); onStartKey(); });
  for (const id in map) {
    const el = document.getElementById(id), k = map[id];
    el.addEventListener('pointerdown', e => { e.preventDefault(); touchK[k] = true; if (k === 'J') jumpLatch = true; if (G.mode !== 'play') onStartKey(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => { touchK[k] = false; });
  }
}
function readInput() {
  let steer = (keys.ArrowRight || keys.KeyD || touchK.R ? 1 : 0) - (keys.ArrowLeft || keys.KeyA || touchK.L ? 1 : 0);
  let tuck = !!(keys.ArrowDown || keys.KeyS || touchK.T), brake = !!(keys.ArrowUp || keys.KeyW || touchK.B), jump = jumpLatch; jumpLatch = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp || !gp.connected) continue; const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (Math.abs(ax) > 0.18) steer = clamp(steer + ax, -1, 1); if (ay > 0.5) tuck = true; if (ay < -0.5) brake = true;
    const a = !!(gp.buttons[0] && gp.buttons[0].pressed), st = !!(gp.buttons[9] && gp.buttons[9].pressed);
    if (a && !padJump) { jump = true; auInit(); if (G.mode !== 'play') onStartKey(); } padJump = a; if (st && !padStart) { auInit(); onStartKey(); } padStart = st; break;
  }
  return { steer, tuck, brake, jump };
}

// ---------------------------------------------------------------- the attract-mode rider: a simple AI that dodges and hits a jump now and then
const AI = { next: 0, th: 0, cost: 0, trick: 0, list: [] };
function planLine(px, pz, pth, speed, margin, wantRamp) {
  const list = AI.list; list.length = 0;
  forObs(px - 36, px + 36, pz - 3, pz + 52, o => list.push(o));
  for (const n of NPCS) list.push({ x: n.x + Math.sin(n.th) * n.v * 0.7, z: n.z + Math.cos(n.th) * n.v * 0.7, r: n.r + 1 });
  let ramp = null;
  for (let cz = Math.floor(pz / CS); cz <= Math.floor((pz + 60) / CS); cz++) for (let cx = Math.floor((px - 30) / CS); cx <= Math.floor((px + 30) / CS); cx++)
    for (const r of dataC(cx, cz).ramps) { list.push({ x: r.x - r.W / 2 - 0.4, z: r.z + r.L * 0.6, r: 1 }, { x: r.x + r.W / 2 + 0.4, z: r.z + r.L * 0.6, r: 1 }); if (wantRamp && !ramp && r.z > pz + 4 && r.z - pz < 55 && Math.abs(r.x - px) < 4 + (r.z - pz) * 0.4) ramp = r; }
  const look = clamp(speed * 2.1, 20, 44); let best = 1e9, bth = 0;
  for (let k = 0; k < 15; k++) {
    const th = -1.05 + k * 0.15, sx = Math.sin(th), sz = Math.cos(th); let c = Math.abs(th) * 1.2 + Math.abs(th - pth) * 1.5;
    for (let d = 2.5; d <= look; d += 2.5) {
      const x = px + sx * d, z = pz + sz * d; let hit = false;
      for (let i = 0; i < list.length; i++) { const o = list[i], dx = o.x - x, dz = o.z - z, rr = o.r + margin; if (dx * dx + dz * dz < rr * rr) { hit = true; break; } }
      if (hit) { c += 95 * (1 - d / (look + 10)); break; }
    }
    if (ramp) c += Math.abs(px + sx * (ramp.z + 1 - pz) / sz - ramp.x) * 0.8;
    if (c < best) { best = c; bth = th; }
  }
  return { th: bth, cost: best, ramp };
}
function aiInput() {
  const I = { steer: 0, tuck: false, brake: false, jump: false }, p = P; if (p.phase !== 'ride') return I;
  const sp = Math.hypot(p.vx, p.vz);
  if (p.air) { if (AI.trick && p.airT > 0.06 && Math.abs(p.spin) < TAU - 0.25) I.steer = AI.trick; return I; }
  if (G.t >= AI.next) { const pl = planLine(p.x, p.z, p.th, sp, 1.5, true); AI.th = pl.th; AI.cost = pl.cost; AI.next = G.t + 0.05; }
  const rh = rampAt(p.x, p.z);
  I.steer = clamp(((rh > 0.05 ? p.th * 0.4 : AI.th) - p.th) * 3.4, -1, 1);
  I.brake = AI.cost > 60 && sp > 9; I.tuck = AI.cost < 4 && sp < 17;
  if (rh > 1.3) { I.jump = true; AI.trick = sp > 15.5 ? (frand() < 0.5 ? 1 : -1) : 0; }
  return I;
}

// ---------------------------------------------------------------- the player's sled
function crash(o) {
  const p = P; if (p.phase !== 'ride') return;
  const sp = Math.hypot(p.vx, p.vz), dx = sp > 0.1 ? p.vx / sp : 0, dz = sp > 0.1 ? p.vz / sp : 1; let nx = 0, nz = 0;
  if (o) { nx = p.x - o.x; nz = p.z - o.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
  let tx = -nz, tz = nx; const td = tx * dx + tz * dz; if (Math.abs(td) < 0.15 ? frand() < 0.5 : td < 0) { tx = -tx; tz = -tz; }
  const gy = Hg(p.x, p.z), k = Math.max(6, sp * 0.4);
  Object.assign(RD, { x: p.x, z: p.z, y: Math.max(p.y, gy), vx: o ? tx * k : p.vx * 0.5, vz: o ? tz * k + 3.5 : p.vz * 0.5, roll: 0, yaw: p.th, vy: 3.5 });
  Object.assign(SD, { x: p.x - tx * 0.5, z: p.z - tz * 0.5, y: gy, vx: o ? -tx * 4.5 : p.vx * 0.8 + 1.5, vz: o ? -tz * 4.5 + Math.max(7, sp * 0.5) : p.vz * 0.8 + 2, flip: 0, yaw: p.th + p.spin });
  RD.px = RD.x; RD.py = RD.y; RD.pz = RD.z; SD.px = SD.x; SD.py = SD.y; SD.pz = SD.z;
  p.phase = 'crash'; p.pt = 0; p.air = false; p.vx = p.vz = p.vy = 0; p.w = 0; p.spin = p.pspin = 0; p.reach = 0; p.lean = 0; p.slip = 0; tLast = null;
  if (G.mode === 'play') pop('WIPEOUT!', CSS.cherry);
  sfxCrash(); spray(p.x, gy + 0.3, p.z, 46, dx * sp * 0.2, 4.5, dz * sp * 0.2, 7, 0.9);
}
function slideBody(e, dt, dec) {
  e.px = e.x; e.py = e.y; e.pz = e.z; const sp = Math.hypot(e.vx, e.vz);
  if (sp > 0) { const ns = Math.max(0, sp - dec * dt); e.vx *= ns / sp; e.vz *= ns / sp; }
  e.x += e.vx * dt; e.z += e.vz * dt; const bx = e.x, bz = e.z;
  if (pushOut(e, 0.6)) { let nx = e.x - bx, nz = e.z - bz; const l = Math.hypot(nx, nz); if (l > 1e-6) { nx /= l; nz /= l; const vn = e.vx * nx + e.vz * nz; if (vn < 0) { e.vx -= nx * vn; e.vz -= nz * vn; } } }   // slide around it, never through
  return sp;
}
function stepPlayer(I, dt) {
  const p = P; p.px = p.x; p.py = p.y; p.pz = p.z; p.pth = p.th; p.pspin = p.spin; p.pt += dt; p.brakeOn = false; p.tuckOn = false;
  if (p.phase === 'push') {                      // pushing off from the hut
    const v = 4.6 * smooth(clamp(p.pt / 1.1, 0, 1)); p.vx = 0; p.vz = v; p.z += v * dt; p.y = Hf(p.x, p.z); p.vyg = (p.y - p.py) / dt;
    if (p.pt > 1.25) { p.phase = 'ride'; p.pt = 0; }
    trackPoint(p.x, p.z, 0, G.t); return;
  }
  if (p.phase === 'crash') {
    const rs = slideBody(RD, dt, 7.5), g1 = Hg(RD.x, RD.z); RD.vy -= 22 * dt; RD.y += RD.vy * dt; if (RD.y < g1) { RD.y = g1; RD.vy = rs > 2 ? rs * 0.22 : 0; }
    RD.roll += rs * 1.6 * dt;
    const ss = slideBody(SD, dt, 7.5); SD.y = Hg(SD.x, SD.z); SD.flip = Math.min(TAU, SD.flip + (5 + ss) * dt); SD.yaw += ss * 0.25 * dt;
    if (rs > 3 && (G.frame & 7) === 0) spray(RD.x, RD.y + 0.2, RD.z, 2, 0, 2, 0, 3, 0.5);
    p.x = RD.x; p.z = RD.z; p.y = RD.y;
    if (p.pt > 1.05 && rs < 0.3 && ss < 0.3) { p.phase = 'getup'; p.pt = 0; RD.y = g1; SD.flip = TAU; }
    return;
  }
  if (p.phase === 'getup') { RD.px = RD.x; RD.py = RD.y; RD.pz = RD.z; SD.px = SD.x; SD.py = SD.y; SD.pz = SD.z; if (p.pt > 0.85) { p.phase = 'hop'; p.pt = 0; p.hx = RD.x; p.hz = RD.z; p.hopT = 0.35 + Math.hypot(SD.x - RD.x, SD.z - RD.z) / 13; } return; }
  if (p.phase === 'hop') {                       // trot back to the sled (round anything in the way) and hop on
    RD.px = RD.x; RD.py = RD.y; RD.pz = RD.z; const dx = SD.x - RD.x, dz = SD.z - RD.z, d = Math.hypot(dx, dz), st = 9 * dt;
    if (d > st && p.pt < 4) { RD.x += dx / d * st; RD.z += dz / d * st; if (d > 1.3) pushOut(RD, 0.5); RD.yaw = Math.atan2(dx, dz); RD.y = Hg(RD.x, RD.z) + (d < 1.6 ? Math.sin((1.6 - d) / 1.6 * Math.PI) * 0.45 : 0); }
    else { p.phase = 'ride'; p.pt = 0; p.x = SD.x; p.z = SD.z; p.y = Hf(p.x, p.z); p.px = p.x; p.py = p.y; p.pz = p.z; p.vx = p.vz = 0; p.vyg = 0; p.th = p.pth = 0; p.w = 0; p.grace = 1.6; return; }
    p.x = RD.x; p.z = RD.z; p.y = RD.y; return;
  }
  if (p.phase !== 'ride') return;
  if (p.grace > 0) p.grace -= dt;
  const sp0 = Math.hypot(p.vx, p.vz);
  if (!p.air) {
    const ice = p.ice = iceAt(p.x, p.z) > 0 ? 1 : 0;
    const wmax = 2.25 / (1 + sp0 / 45) * (ice ? 0.4 : 1) * clamp(sp0 / 3, 0.35, 1);
    p.w += (I.steer * wmax - p.w) * Math.min(1, dt * (ice ? 4 : 9));
    p.th += p.w * dt; if (p.th > 1.5) { p.th = 1.5; p.w = 0; } else if (p.th < -1.5) { p.th = -1.5; p.w = 0; }
    const sx = Math.sin(p.th), cz = Math.cos(p.th), e = 0.35;
    const gx = (Hg(p.x + e, p.z) - Hg(p.x - e, p.z)) / (2 * e), gz = (Hg(p.x, p.z + e) - Hg(p.x, p.z - e)) / (2 * e);
    let vf = p.vx * sx + p.vz * cz, vl = p.vx * cz - p.vz * sx;
    const af = -GRAV * (gx * sx + gz * cz), al = -GRAV * (gx * cz - gz * sx);
    vl += al * dt * (ice ? 1 : 0.3); vl *= Math.exp(-(ice ? 0.55 : I.brake ? 15 : 10) * dt);
    p.brakeOn = I.brake; p.tuckOn = I.tuck && !I.brake;
    vf += (af - (p.tuckOn ? KT : KN) * vf * Math.abs(vf)) * dt;
    if (vf < 1.3 && !I.brake && Math.abs(p.th) < 1.2) vf += 1.6 * dt;                    // a little scoot so the sled never sits stuck
    const f = (I.brake ? 0.42 : 0.03) * (ice ? 0.3 : 1) * GRAV * dt; vf = vf > f ? vf - f : 0;
    p.slip = vl; p.vx = sx * vf + cz * vl; p.vz = cz * vf - sx * vl;
    p.lean += (clamp(p.w * vf * 0.03, -0.5, 0.5) - p.lean) * Math.min(1, dt * 8);
    p.x += p.vx * dt; p.z += p.vz * dt;
    const hN = Hf(p.x, p.z), vyg = (hN - p.y) / dt;
    if (hN - p.y > 0.55) { crash({ x: p.x + p.vx * 0.05, z: p.z + p.vz * 0.05 }); return; }                 // ran into the side of a ramp
    if (I.jump) { const rh = rampAt(p.x, p.z); p.air = true; p.vy = Math.max(vyg, p.vyg) + (rh > 0.25 ? 7.2 : 5.2); burst(700, 0.8, 0.12, 0.15, 'bandpass'); }
    else if (p.vyg - vyg > GA * dt + 0.03) { p.air = true; p.vy = p.vyg; }
    if (p.air) { p.airT = 0; p.spin = p.pspin = 0; p.reach = 0; p.reachT = 0; p.y = Math.max(hN, p.y + p.vy * dt); tLast = null; }
    else { p.y = hN; p.vyg = vyg; if (sp0 > 0.6) trackPoint(p.x, p.z, p.th, G.t); }
    const carve = Math.abs(vl) * 0.9 + Math.abs(p.w) * vf * 0.05 + (I.brake ? vf * 0.12 : 0);
    if (!p.air && carve > 0.9 && frand() < carve * 0.11) { const sd = vl > 0 ? 1 : -1; spray(p.x - sx * 0.5, p.y + 0.1, p.z - cz * 0.5, 1, cz * sd * 2.5 + p.vx * 0.4, 1.6 + carve * 0.25, -sx * sd * 2.5 + p.vz * 0.4, 2.5, 0.42); }
  } else {
    p.airT += dt; p.vy -= GA * dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
    if (p.airT > 0.05 && I.steer) p.spin += I.steer * 7.6 * dt;
    if (I.brake) { p.reach = Math.min(1, p.reach + dt * 6); p.reachT += dt; } else p.reach = Math.max(0, p.reach - dt * 5);
    p.lean *= 1 - Math.min(1, dt * 6);
    const hN = Hf(p.x, p.z);
    if (hN - p.y > 0.55) { crash({ x: p.x + p.vx * 0.05, z: p.z + p.vz * 0.05 }); return; }
    if (p.y <= hN) {                             // touchdown
      const rem = Math.abs(wrapPi(p.spin)), rots = Math.round(Math.abs(p.spin) / TAU), airT = p.airT;
      p.air = false; p.y = hN; p.vyg = (hN - p.py) / dt;
      if (airT > 0.14) { sfxThump(clamp(airT, 0.3, 1)); spray(p.x, hN + 0.1, p.z, airT > 0.4 ? 14 : 5, p.vx * 0.3, 2.2, p.vz * 0.3, 4, 0.5); }
      if (rem > 0.8 || p.reach > 0.4) { crash(null); return; }
      const pts = rots * 100 + (rots > 1 ? (rots - 1) * 50 : 0) + Math.round(p.reachT * 12) * 10 + (airT > 0.7 ? Math.round(airT * 4) * 10 : 0);
      if (G.mode === 'play' && (pts > 0 || airT > 0.8)) { p.style += pts; pop(pts ? 'NICE AIR +' + pts : 'NICE AIR', CSS.teal); }
      p.spin = p.pspin = 0; p.reach = 0;
    }
  }
  // collisions: nothing passes through a tree, rock or person
  const above = p.y - Hg(p.x, p.z); let hitO = null;
  forObs(p.x - 5, p.x + 5, p.z - 5, p.z + 5, o => { if (hitO || above > o.h) return; const dx = p.x - o.x, dz = p.z - o.z, rr = o.r + 0.5; if (dx * dx + dz * dz < rr * rr) hitO = o; });
  if (!hitO && above < 1.5 && p.grace <= 0) for (const n of NPCS) { const dx = p.x - n.x, dz = p.z - n.z, rr = n.r + 0.5; if (dx * dx + dz * dz < rr * rr) { hitO = n; if (n.down <= 0) { n.down = 2.6; n.v *= 0.3; } break; } }
  if (hitO && hitO.t && Math.hypot(p.vx, p.vz) < 3.5 && !p.air) {
    let nx = p.x - hitO.x, nz = p.z - hitO.z; const l = Math.hypot(nx, nz) || 1, rr = hitO.r + 0.52; nx /= l; nz /= l; p.x = hitO.x + nx * rr; p.z = hitO.z + nz * rr;
    const vn = p.vx * nx + p.vz * nz; if (vn < 0) { p.vx -= nx * vn; p.vz -= nz * vn; } p.th += (nx > 0 ? 1 : -1) * 1.2 * dt; p.y = Hf(p.x, p.z); hitO = null;
  }
  if (hitO) { crash(hitO); return; }
  // slalom gates
  const gs = dataAt(p.x, p.z).gates;
  for (let i = 0; i < gs.length; i++) {
    const g = gs[i]; if (g.done || p.z < g.z || p.pz > g.z + 2) continue; g.done = 1; const dx = Math.abs(p.x - g.x);
    if (dx < g.hw - 0.2) { if (G.mode === 'play') { p.style += 50; pop('SLALOM +50', CSS.teal); sfxChime(); } }
    else if (dx < 16 && G.mode === 'play') { p.style = Math.max(0, p.style - 20); pop('MISSED -20', CSS.wood); sfxMiss(); }
  }
  if (G.mode === 'play') p.dist = Math.max(p.dist, p.z - START.z);
}

// ---------------------------------------------------------------- other slope life
let npcTimer = 2;
function spawnNPC() {
  const k = frand(), type = k < 0.34 ? 'sledder' : k < 0.56 ? 'saucer' : k < 0.8 ? 'boarder' : 'dog';
  if (type === 'dog' && NPCS.some(n => n.type === 'dog')) return;
  const cols = [0, 1, 2, 3].sort(() => frand() - 0.5), look = { coat: ACC[cols[0]], hat: ACC[cols[1]], scarf: ACC[cols[2]], pants: frand() < 0.5 ? C.rockD : C.bark };
  const n = { type, g: new THREE.Group(), x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, th: 0, v: 0, r: 0.7, t: frand() * 10, down: 0, ph: frand() * TAU, chase: 0, anim: 0, home: 0 };
  const side = frand() < 0.5 ? -1 : 1;
  if (type === 'sledder') { n.per = makePerson(look); poseSit(n.per); n.g.add(makeSled(ACC[cols[3]], C.wood)); n.g.add(n.per.g); n.x = P.x + (frand() - 0.5) * 50; n.z = P.z + 58; n.v = 8 + frand() * 3; n.home = (frand() - 0.5) * 0.5; }
  else if (type === 'saucer') { look.scale = 0.85; n.per = makePerson(look); pose(n.per, 0.3, 0, -0.2, -1.5, -1.5, -0.4, -0.4, 0.9, 0.35); n.g.add(makeSaucer(ACC[cols[3]])); n.g.add(n.per.g); n.x = P.x + side * 46; n.z = P.z + 22 + frand() * 26; n.v = 7.5 + frand() * 2; n.home = -side * (0.75 + frand() * 0.3); n.r = 0.75; }
  else if (type === 'boarder') { n.per = makePerson(look); pose(n.per, 0.6, 0, 0.15, 0.25, -0.25, 0.2, 0.2, 1.1, 0.3); n.per.g.rotation.y = Math.PI / 2; n.per.g.position.y = 0.1; n.g.add(makeBoard(ACC[cols[3]])); n.g.add(n.per.g); n.x = P.x + (frand() - 0.5) * 40; n.z = P.z + 58; n.v = 10.5 + frand() * 2.5; }
  else { n.dog = makeDog(); n.g.add(n.dog.g); n.x = P.x + side * (8 + frand() * 14); n.z = P.z + 56; n.v = 0; n.r = 0.55; n.th = -side * 1.2; }
  pushOut(n, n.r + 0.6); n.y = Hg(n.x, n.z); n.px = n.x; n.py = n.y; n.pz = n.z; if (type !== 'dog') n.th = n.home;
  world.add(n.g); NPCS.push(n);
}
function steerAround(e, th, look, rad) {       // nudge a heading away from the nearest solid thing ahead
  let best = 1e9, bias = 0; const sx = Math.sin(th), sz = Math.cos(th);
  forSolid(e.x + sx * look * 0.5, e.z + sz * look * 0.5, look, o => {
    const dx = o.x - e.x, dz = o.z - e.z, f = dx * sx + dz * sz; if (f < 0 || f > look) return; const l = dx * sz - dz * sx, rr = o.r + rad + 0.8;
    if (Math.abs(l) < rr && f < best) { best = f; bias = (l > 0 ? -1 : 1) * (1 - f / look) * 1.6; }
  });
  return bias;
}
function stepNPCs(dt) {
  if (G.mode !== 'over' && (npcTimer -= dt) <= 0) { npcTimer = 2.2 + frand() * 3.2; if (NPCS.length < 4 && P.phase === 'ride') spawnNPC(); }
  for (let i = NPCS.length - 1; i >= 0; i--) {
    const n = NPCS[i]; n.px = n.x; n.py = n.y; n.pz = n.z; n.t += dt;
    if (n.z < P.z - 50 || n.z > P.z + 120 || Math.abs(n.x - P.x) > 80) { world.remove(n.g); n.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); NPCS.splice(i, 1); continue; }
    if (n.down > 0) { n.down -= dt; n.v = Math.max(0, n.v - 12 * dt); }
    else if (n.type === 'dog') {                 // sits and watches, then chases the sled for a bit
      const dx = P.x - n.x, dz = P.z - n.z, d = Math.hypot(dx, dz);
      if (n.chase === 0 && d < 26 && P.phase === 'ride') n.chase = 5.5 + frand() * 2;
      if (n.chase > 0) {                         // runs alongside, a couple of metres off the sled's flank
        n.chase -= dt; if (n.chase <= 0) n.chase = -1;
        const c = Math.cos(P.th), sn = Math.sin(P.th), side = (-dx * c + dz * sn) >= 0 ? 1 : -1, sp = Math.hypot(P.vx, P.vz);
        const txx = P.x + c * side * 2.7 + P.vx * 0.45, tzz = P.z - sn * side * 2.7 + P.vz * 0.45, want = Math.atan2(txx - n.x, tzz - n.z);
        n.th += clamp(wrapPi(want - n.th + steerAround(n, n.th, 7, n.r)), -1, 1) * 5 * dt; n.v += (Math.min(14, d > 3.5 ? sp + 3.5 : sp) - n.v) * Math.min(1, dt * 3);
      }
      else n.v = Math.max(0, n.v - 10 * dt);
    } else {
      const want = n.type === 'boarder' ? 0.95 * Math.sin(n.t * 0.85 + n.ph) : n.home + 0.2 * Math.sin(n.t * 0.5 + n.ph);
      n.th += clamp(want + steerAround(n, n.th, 9, n.r) - n.th, -1, 1) * 3 * dt; n.th = clamp(n.th, -1.4, 1.4);
      const tv = n.type === 'sledder' ? 9.5 : n.type === 'saucer' ? 8.5 : 11.5; n.v += (tv - n.v) * Math.min(1, dt * 1.5);
    }
    n.x += Math.sin(n.th) * n.v * dt; n.z += Math.cos(n.th) * n.v * dt; n.anim += n.v * dt;
    pushOut(n, n.r + 0.15);
    for (const m of NPCS) if (m !== n) { const dx = n.x - m.x, dz = n.z - m.z, rr = n.r + m.r, d2 = dx * dx + dz * dz; if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); n.x = m.x + dx / d * rr; n.z = m.z + dz / d * rr; } }
    if (P.phase === 'crash' || P.phase === 'getup' || P.phase === 'hop') for (const e of [RD, SD]) { const dx = n.x - e.x, dz = n.z - e.z, rr = n.r + 0.8, d2 = dx * dx + dz * dz; if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); n.x = e.x + dx / d * rr; n.z = e.z + dz / d * rr; } }
    if (YETI.st !== 'off') { const dx = n.x - YETI.x, dz = n.z - YETI.z, rr = n.r + 1.6, d2 = dx * dx + dz * dz; if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); n.x = YETI.x + dx / d * rr; n.z = YETI.z + dz / d * rr; } }
    n.y = Hg(n.x, n.z);
  }
}
function drawNPCs(a) {
  for (const n of NPCS) {
    const x = lerp(n.px, n.x, a), z = lerp(n.pz, n.z, a), y = lerp(n.py, n.y, a), e = 0.5, sx = Math.sin(n.th), sz = Math.cos(n.th);
    const pitch = Math.atan(-(Hsm(x + sx * e, z + sz * e) - Hsm(x - sx * e, z - sz * e)) / (2 * e));
    if (n.type === 'dog') {
      place(n.g, x, y, z, n.th, pitch * 0.6, 0); const run = n.v > 1, s = Math.sin(n.anim * 2.4);
      n.dog.legs[0].rotation.x = run ? s * 0.9 : -0.2; n.dog.legs[1].rotation.x = run ? -s * 0.9 : -0.2; n.dog.legs[2].rotation.x = run ? -s * 0.9 : 1.2; n.dog.legs[3].rotation.x = run ? s * 0.9 : 1.2;
      n.dog.g.position.y = run ? Math.abs(s) * 0.12 : -0.14; n.dog.g.rotation.x = run ? 0 : -0.35;
    } else {
      const lean = n.type === 'boarder' ? Math.cos(n.t * 0.85 + n.ph) * 0.3 : 0;
      place(n.g, x, y + 0.02, z, n.th + (n.type === 'saucer' ? n.t * 0.9 : 0), pitch, n.down > 0 ? clamp((2.6 - n.down) * 4, 0, 1.45) : -lean);
    }
  }
}

// ---------------------------------------------------------------- the Yeti
function yetiBurst() {
  const y = YETI, side = frand() < 0.5 ? -1 : 1; let tx = P.x + P.vx * 1.1 + side * 21, tz = P.z + P.vz * 1.1 + 3, bd = 1e9, bt = null;
  forObs(tx - 9, tx + 9, tz - 10, tz + 10, o => { if (o.t !== 'pine' || o.s < 0.6) return; const d = Math.hypot(o.x - tx, o.z - tz); if (d < bd) { bd = d; bt = o; } });
  if (bt) { tx = bt.x; tz = bt.z - bt.r - 1.6; }      // he steps out from behind a tree
  Object.assign(y, { st: 'burst', t: 0, x: tx, z: tz, v: 0, th: Math.atan2(P.x - tx, P.z - tz), chaseT: 0 }); pushOut(y, 1.7);
  y.y = Hg(y.x, y.z); y.px = y.x; y.py = y.y; y.pz = y.z; y.g.visible = true;
  G.warn = 2.2; G.warnSide = side; sfxRoar(); spray(y.x, y.y + 1, y.z, 60, 0, 6, 0, 9, 1.1);
}
function stepYeti(dt) {
  const y = YETI, p = P; y.px = y.x; y.py = y.y; y.pz = y.z; y.t += dt;
  if (G.warn > 0) G.warn -= dt;
  if (y.st === 'off') { if (G.mode === 'play' && p.dist >= y.nextAt && p.phase === 'ride' && !p.air) yetiBurst(); return; }
  const dx = p.x - y.x, dz = p.z - y.z, d = Math.hypot(dx, dz);
  if (y.st === 'burst') { y.th = Math.atan2(dx, dz); if (y.t > 0.9) { y.st = 'chase'; y.t = 0; y.v = 6; } }
  else if (y.st === 'chase') {
    y.chaseT += dt;
    const sl = slopeAt(y.z), target = lerp(22.5, 18.5, clamp((sl - 0.16) / 0.17, 0, 1)) + Math.min(6, y.chaseT * 0.05);   // faster on the flats, slower on the steeps
    y.v += clamp(target - y.v, -10 * dt, 12 * dt);
    const lead = clamp(d / 20, 0, 0.7), want = Math.atan2(dx + p.vx * lead, dz + p.vz * lead);
    y.th += clamp(wrapPi(want + steerAround(y, y.th, 9, 1.6) - y.th), -1, 1) * 4.5 * dt;
    y.x += Math.sin(y.th) * y.v * dt; y.z += Math.cos(y.th) * y.v * dt; y.run += y.v * dt; pushOut(y, 1.6);
    if ((G.frame & 15) === 0) spray(y.x, y.y + 0.2, y.z, 2, 0, 2.5, 0, 4, 0.5);
    if (d < 2.7 && p.y - Hg(p.x, p.z) < 3.2 && G.mode === 'play') {      // got you
      if (p.phase === 'ride' || p.phase === 'push') { Object.assign(RD, { x: p.x, y: p.y, z: p.z }); Object.assign(SD, { x: p.x, y: p.y, z: p.z }); }
      y.st = 'grab'; y.t = 0; y.v = 0; p.phase = 'caught'; p.pt = 0; p.air = false; p.vx = p.vz = 0; G.warn = 0; sfxStomp(); burst(900, 0.6, 0.3, 0.3, 'lowpass');
      G.best = Math.max(G.best, Math.floor(p.dist)); try { localStorage.setItem('sledfree.best', String(G.best)); } catch (e) { }
    } else if (d > 165) { y.st = 'giveup'; y.t = 0; y.nextAt = p.dist + 900; }
  }
  else if (y.st === 'giveup') { y.v = Math.max(0, y.v - 10 * dt); y.x += Math.sin(y.th) * y.v * dt; y.z += Math.cos(y.th) * y.v * dt; pushOut(y, 1.6); if (d > 150 || y.t > 6) { y.st = 'off'; y.g.visible = false; } }
  else if (y.st === 'grab') {                    // scoop, happy stomp, lumber off
    if (y.t < 2.3) { y.th += wrapPi(0.5 - y.th) * Math.min(1, dt * 4); const k = Math.floor((y.t - 0.6) / 0.5), k0 = Math.floor((y.t - dt - 0.6) / 0.5); if (y.t > 0.6 && k !== k0 && k < 4) { sfxStomp(); spray(y.x, y.y + 0.2, y.z, 22, 0, 3.5, 0, 8, 0.7); } }
    else if (y.t <= 14) { y.th += wrapPi(-2.2 - y.th) * Math.min(1, dt * 2.5); y.v += (3.4 - y.v) * Math.min(1, dt * 2); y.x += Math.sin(y.th) * y.v * dt; y.z += Math.cos(y.th) * y.v * dt; y.run += y.v * dt; pushOut(y, 1.6); }
    if (y.t > 3.4 && G.mode === 'play') { G.mode = 'over'; G.overT = 0; }
    if (y.t < 2.3) { p.x = y.x; p.z = y.z; p.y = Hg(y.x, y.z); }
    if (y.t > 14) { y.v = 0; y.g.visible = rider.g.visible = sledG.visible = false; }
  }
  y.y = Hg(y.x, y.z);
}
function drawYeti(a) {
  const y = YETI; if (!y.g.visible) return;
  const x = lerp(y.px, y.x, a), z = lerp(y.pz, y.z, a); let yy = lerp(y.py, y.y, a) - 0.1, bob = 0, aL = 0, aR = 0, lL = 0, lR = 0, az = 0.25, sc = 1;
  if (y.st === 'burst') { const k = clamp(y.t / 0.35, 0, 1); sc = 0.4 + 0.6 * k; bob = Math.sin(clamp(y.t / 0.7, 0, 1) * Math.PI) * 1.6; aL = aR = -2.7; az = 0.7; }
  else if (y.st === 'chase' || y.st === 'giveup') { const s = Math.sin(y.run * 0.75); lL = s * 0.8; lR = -s * 0.8; aL = -1.9 - s * 0.5; aR = -1.9 + s * 0.5; bob = Math.abs(s) * 0.35; if (y.st === 'giveup' && y.v < 1) { aL = aR = -0.2; } }
  else if (y.st === 'grab') {
    if (y.t < 2.3) { const h = y.t > 0.6 && y.t < 2.6 ? Math.abs(Math.sin((y.t - 0.6) / 0.5 * Math.PI)) : 0; bob = h * 0.9; aR = -2.6 * h; lL = h * 0.4; lR = -h * 0.4; }
    else { const s = Math.sin(y.run * 0.9); lL = s * 0.6; lR = -s * 0.6; aR = -s * 0.4; bob = Math.abs(s) * 0.2; }
    aL = -0.35; az = 0.1;
  }
  place(y.g, x, yy + bob, z, y.th, 0, 0); y.g.scale.setScalar(sc * 1.3);
  y.aL.rotation.set(aL, 0, -az); y.aR.rotation.set(aR, 0, az); y.lL.rotation.x = lL; y.lR.rotation.x = lR; y.body.rotation.z = (lL - lR) * 0.04;
  if (y.st === 'grab') {                         // rider and sled tucked under one arm
    const k = smooth(clamp(y.t / 0.5, 0, 1)), c = Math.cos(y.th), s = Math.sin(y.th), ox = -1.95, oy = 2.3, oz = 0.3;
    const hx = x + ox * c + oz * s, hz = z - ox * s + oz * c, hy = yy + bob + oy;
    place(rider.g, lerp(RD.x, hx, k), lerp(RD.y, hy, k), lerp(RD.z, hz, k), y.th, 1.35 * k, 0); pose(rider, 0.44, 0, 0, -0.3 + Math.sin(G.t * 9) * 0.5, -0.3 - Math.sin(G.t * 9) * 0.5, -2.6 + Math.sin(G.t * 11) * 0.4, -2.6 - Math.sin(G.t * 11) * 0.4, 0.3);
    place(sledG, lerp(SD.x, hx - 0.55 * c, k), lerp(SD.y, hy - 0.5, k), lerp(SD.z, hz + 0.55 * s, k), y.th, 1.35 * k, 1.5 * k);
  }
}

// ---------------------------------------------------------------- drawing the player
function drawPlayer(a) {
  const p = P, r = rider;
  if (p.phase === 'caught') return;
  const x = lerp(p.px, p.x, a), y = lerp(p.py, p.y, a), z = lerp(p.pz, p.z, a);
  if (p.phase === 'ride' || p.phase === 'push') {
    const yaw = p.th + lerp(p.pspin, p.spin, a), sx = Math.sin(p.th), cz = Math.cos(p.th), e = 0.6;
    let pitch;
    if (p.air) pitch = clamp(Math.atan2(-p.vy, Math.hypot(p.vx, p.vz) + 1) * 0.55, -0.5, 0.6);
    else pitch = Math.atan(-(Hf(x + sx * e, z + cz * e) - Hf(x - sx * e, z - cz * e)) / (2 * e));
    place(sledG, x, y + 0.02, z, yaw, pitch, -p.lean);
    if (p.phase === 'push' && p.pt < 0.95) {     // running push from behind the sled
      const s = Math.sin(p.pt * 16); place(r.g, x, Hg(x, z - 1.0), z - 1.0, 0, 0, 0); pose(r, 0.6, 0, 0.55, s * 0.9, -s * 0.9, -1.3, -1.3, 0.15);
    } else {
      r.g.position.copy(sledG.position); r.g.quaternion.copy(sledG.quaternion);
      if (p.phase === 'push') { poseSit(r); r.g.position.y += Math.sin((p.pt - 0.95) / 0.3 * Math.PI) * 0.35; }
      else if (p.reach > 0.02) { const k = smooth(p.reach); pose(r, lerp(0.44, 0.78, k), 1.45 * k, lerp(-0.15, 0, k), lerp(-1.45, 0.1, k), lerp(-1.45, 0.1, k), lerp(-0.6, -2.9, k), lerp(-0.6, -2.9, k), 0.2); r.hip.position.z = -0.35 * k; }   // the superman reach
      else if (p.air) pose(r, 0.44, 0, -0.05, -1.3, -1.3, -2.4, -2.4, 0.7, 0.2);
      else if (p.brakeOn) pose(r, 0.44, 0, -0.5, -1.15, -1.15, -0.2, -0.2, 0.3, 0.45);
      else if (p.tuckOn) pose(r, 0.44, 0, 0.85, -1.5, -1.5, -1.5, -1.5, 0.1, 0.05);
      else poseSit(r, -0.15 - Math.min(0.1, Math.hypot(p.vx, p.vz) * 0.004));
      if (p.reach <= 0.02) r.hip.position.z = 0;
    }
    return;
  }
  // off the sled: tumble, get up, brush off, hop back on
  r.hip.position.z = 0;
  const rx = lerp(RD.px, RD.x, a), ry = lerp(RD.py, RD.y, a), rz = lerp(RD.pz, RD.z, a);
  const sxp = lerp(SD.px, SD.x, a), szp = lerp(SD.pz, SD.z, a), sy = lerp(SD.py, SD.y, a);
  const up = SD.flip >= TAU ? 0 : Math.sin(SD.flip * 0.5) * 0.6;
  place(sledG, sxp, sy + 0.02 + up, szp, SD.yaw, 0, SD.flip);
  if (p.phase === 'crash') {
    const lying = Math.hypot(RD.vx, RD.vz) < 0.3; place(r.g, rx, ry + 0.35, rz, RD.yaw, lying ? -1.45 : RD.roll, 0);
    pose(r, 0.2, 0, lying ? 0 : 0.6, lying ? 0.1 : -1.0, lying ? -0.1 : -0.4, lying ? -2.6 : -1.8, lying ? -2.9 : 0.6, 0.6, 0.2);
  } else if (p.phase === 'getup') {
    const k = smooth(clamp(p.pt / 0.3, 0, 1)), b = Math.sin(p.pt * 24);
    place(r.g, rx, ry + 0.35 * (1 - k), rz, RD.yaw, -1.45 * (1 - k), 0); pose(r, lerp(0.2, 0.63, k), 0, 0.2 * k, 0, 0, -0.9 + b * 0.5, -0.9 - b * 0.5, 0.05 + Math.abs(b) * 0.25);   // brushing off the snow
  } else {
    const s = Math.sin(p.pt * 18);
    place(r.g, rx, ry, rz, RD.yaw, 0, 0); pose(r, 0.6, 0, 0.3, s * 0.9, -s * 0.9, -s * 0.8, s * 0.8, 0.15);
  }
}

// ---------------------------------------------------------------- camera: fixed isometric, follows smoothly, snapped to whole render pixels
const cam = { x: 0, z: 0, init: false, sx: 0, sy: 0, chase: 0 };
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3();
function updateCamera(a, dt) {
  const p = P, x = lerp(p.px, p.x, a), z = lerp(p.pz, p.z, a);
  const chased = YETI.st === 'burst' || YETI.st === 'chase' || YETI.st === 'grab'; cam.chase += ((chased ? 1 : 0) - cam.chase) * (1 - Math.exp(-dt * 2.5));
  const tx = x + clamp(p.vx * 0.3, -6, 6), tz = z + lerp(8.5 + clamp(p.vz * 0.22, 0, 7), 2.5, cam.chase);
  if (!cam.init) { cam.x = tx; cam.z = tz; cam.init = true; }
  else { const k = 1 - Math.exp(-dt * 4.5); cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k; }
  g2w(cam.x, Hsm(cam.x, cam.z), cam.z, v3).addScaledVector(CDIR, 260);
  const ca = v3.dot(CR), cb = v3.dot(CU), sa = Math.round(ca * PPM), sb = Math.round(cb * PPM);
  v3.addScaledVector(CR, sa / PPM - ca).addScaledVector(CU, sb / PPM - cb);
  camera.position.copy(v3); cam.dx = sa - cam.sx; cam.dy = sb - cam.sy; cam.sx = sa; cam.sy = sb;
  // sun follows, snapped to its own shadow texels so shadows do not crawl
  g2w(cam.x, Hsm(cam.x, cam.z), cam.z, v3b); const tex = SH * 2 / 2048, la = v3b.dot(LR), lb = v3b.dot(LU);
  v3b.addScaledVector(LR, Math.round(la / tex) * tex - la).addScaledVector(LU, Math.round(lb / tex) * tex - lb);
  sun.target.position.copy(v3b); sun.target.updateMatrixWorld(); sun.position.copy(v3b).addScaledVector(LW, 240);
  ensureChunks(cam.x, cam.z, false);
}

// ---------------------------------------------------------------- HUD: a 5x7 pixel font drawn in code, at the scene's pixel scale
const FONT = { A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [30, 1, 1, 14, 1, 1, 30], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '!': [4, 4, 4, 4, 4, 0, 4], '+': [0, 4, 4, 31, 4, 4, 0], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0], '/': [1, 1, 2, 4, 8, 16, 16] };
const textW = (s, sc) => s.length * 6 * sc - sc;
function glyphs(s, x, y, sc, col) {
  hx.fillStyle = col;
  for (let i = 0; i < s.length; i++) { const g = FONT[s[i]]; if (!g) continue; for (let r = 0; r < 7; r++) { const row = g[r]; for (let c = 0; c < 5; c++) if (row & (16 >> c)) hx.fillRect(x + (i * 6 + c) * sc, y + r * sc, sc, sc); } }
}
function text(s, x, y, sc, col, edge, align) {
  x = Math.round(align === 1 ? x - textW(s, sc) / 2 : align === 2 ? x - textW(s, sc) : x); y = Math.round(y);
  const ew = sc > 2 ? 2 : 1; if (edge) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) glyphs(s, x + dx * ew, y + dy * ew, sc, edge);
  glyphs(s, x, y, sc, col);
}
const flakes = []; for (let i = 0; i < 90; i++) flakes.push({ x: frand(), y: frand(), s: 0.5 + frand(), w: frand() * TAU, c: i % 3 });
function drawHUD(dt) {
  hx.clearRect(0, 0, W, H);
  for (const f of flakes) {                      // light snowfall, drifting the whole time
    f.x = (f.x + ((Math.sin(G.t * 0.8 + f.w) * 5 - 4) * dt - (cam.dx || 0) * 0.45) * f.s / W + 2) % 1; f.y = (f.y + (16 * dt + (cam.dy || 0) * 0.45) * f.s / H + 2) % 1;
    hx.fillStyle = f.c === 0 ? CSS.snow0 : f.c === 1 ? CSS.snow3 : CSS.snow2; const s = f.s > 1.25 ? 2 : 1; hx.fillRect(Math.floor(f.x * W), Math.floor(f.y * H), s, s);
  }
  const p = P, mid = W >> 1;
  if (G.mode === 'attract') {
    const sc = W >= 330 ? 5 : W >= 200 ? 3 : 2, ty = Math.round(H * 0.16);
    text('SLED FREE', mid + sc, ty + sc, sc, CSS.wood, null, 1); text('SLED FREE', mid, ty, sc, CSS.cherry, CSS.snow0, 1);
    hx.fillStyle = CSS.teal; hx.fillRect(mid - textW('SLED FREE', sc) / 2, ty + 9 * sc, textW('SLED FREE', sc), Math.max(1, sc >> 1)); hx.fillStyle = CSS.mustard; hx.fillRect(mid - textW('SLED FREE', sc) / 2, ty + 9 * sc + Math.max(1, sc >> 1) + 1, textW('SLED FREE', sc), 1);
    if ((G.t * 1.6) % 1 < 0.62) { const s2 = W >= 340 ? 2 : 1; text('PRESS ENTER OR TAP TO SLED', mid, Math.round(H * 0.8), s2, CSS.wood, CSS.snow0, 1); }
    if (G.best > 0) text('BEST ' + G.best + ' M', mid, Math.round(H * 0.8) + 22, 1, CSS.wood, CSS.snow0, 1);
    return;
  }
  text('DIST ' + Math.floor(p.dist) + ' M', 6, 6, 1, CSS.wood, CSS.snow0); text('SPEED ' + Math.round(Math.hypot(p.vx, p.vz) * 3.6), 6, 17, 1, CSS.wood, CSS.snow0); text('STYLE ' + p.style, 6, 28, 1, CSS.wood, CSS.snow0);
  text('BEST ' + Math.max(G.best, 0) + ' M', W - 6, 6, 1, CSS.wood, CSS.snow0, 2);
  if (AU.mute) text('MUTED', W - 6, 17, 1, CSS.wood, CSS.snow0, 2);
  if (G.pop) { G.pop.t += dt; const t = G.pop.t; if (t > 1.5) G.pop = null; else if (t < 1.2 || (t * 14 | 0) & 1) text(G.pop.text, mid, Math.round(H * 0.2 - Math.min(1, t * 5) * 8), 2, G.pop.col, CSS.snow0, 1); }
  if (YETI.st === 'chase' && G.warn <= 0 && (G.t * 5 % 1) < 0.6) {
    g2w(YETI.x, YETI.y + 3, YETI.z, v3b).project(camera);
    if (v3b.y > 1 && Math.hypot(YETI.x - p.x, YETI.z - p.z) < 60) text('!', clamp(Math.round((v3b.x * 0.5 + 0.5) * W) - 4, 8, W - 20), 5, 2, CSS.cherry, CSS.snow0);
  }
  if (G.warn > 0 && (G.warn * 5 % 1) < 0.65) { const wx = G.warnSide > 0 ? W - 34 : 22; text('!', wx, Math.round(H * 0.42), 5, CSS.cherry, CSS.snow0); text('!', mid - 6, Math.round(H * 0.3), 4, CSS.cherry, CSS.snow0); }
  if (G.mode === 'over') {
    const pw = 190, ph = 104, x0 = mid - pw / 2, y0 = Math.round(H / 2 - ph / 2) - 6, k = clamp(G.overT * 4, 0, 1); if (k < 1) return;
    hx.fillStyle = CSS.wood; hx.fillRect(x0 - 2, y0 - 2, pw + 4, ph + 4); hx.fillStyle = CSS.snow1; hx.fillRect(x0, y0, pw, ph); hx.fillStyle = CSS.snow2; hx.fillRect(x0, y0 + ph - 26, pw, 26); hx.fillStyle = CSS.cherry; hx.fillRect(x0, y0, pw, 3);
    text('THE YETI GOT YOU', mid, y0 + 11, 1, CSS.cherry, null, 1);
    text('DISTANCE', x0 + 16, y0 + 30, 1, CSS.wood); text(Math.floor(p.dist) + ' M', x0 + pw - 16, y0 + 30, 1, CSS.wood, null, 2);
    text('STYLE', x0 + 16, y0 + 43, 1, CSS.wood); text('' + p.style, x0 + pw - 16, y0 + 43, 1, CSS.wood, null, 2);
    text('BEST', x0 + 16, y0 + 56, 1, CSS.teal); text(G.best + ' M', x0 + pw - 16, y0 + 56, 1, CSS.teal, null, 2);
    if ((G.overT * 1.6) % 1 < 0.65) text('PRESS ENTER TO SLED AGAIN', mid, y0 + ph - 17, 1, CSS.wood, null, 1);
  }
}

// ---------------------------------------------------------------- main loop: fixed 120 Hz physics, interpolated rendering
function step(dt) {
  G.t += dt; G.frame++;
  if (G.mode === 'over') G.overT += dt;
  const I = G.mode === 'attract' ? aiInput() : G.mode === 'play' ? readInput() : { steer: 0, tuck: false, brake: false, jump: false };
  stepPlayer(I, dt); stepNPCs(dt); stepYeti(dt);
  if (G.mode === 'attract' && P.z > 60000) resetRun(true);
}
let last = 0, acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; acc += dt;
  if (G.mode !== 'play') { readInput(); jumpLatch = false; }
  while (acc >= STEP) { step(STEP); acc -= STEP; }
  const a = acc / STEP;
  stepParticles(dt); if ((G.frame & 3) < 2) fadeTracks(G.t);
  updateCamera(a, dt); drawPlayer(a); drawNPCs(a); drawYeti(a);
  renderer.setRenderTarget(rt); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(blitScene, blitCam);
  drawHUD(dt); auFrame();
}
resize(); resetRun(true); ensureChunks(P.x, P.z + 10, true);
requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
})();
