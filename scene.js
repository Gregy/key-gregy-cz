// Pixel-art dungeon gate, drawn on a 160x120 canvas and scaled up by whole pixels where possible.
// Every frame: the unlit base (wall, arch, door) -> per-pixel lighting from the torches, the runes and the
// open doorway, ordered-dithered into a few bands so it stays pixel art -> emissive bits drawn on top
// unlit (flames, lit runes, the light behind the door, embers, sparkles).
// Exposes makeScene(canvas), drawKeyIcon(canvas) and wallTile() as globals for app.js.
'use strict';

const SCENE_W = 160, SCENE_H = 120;

function rng(seed) {  // mulberry32; a fixed seed keeps the stonework identical on every visit
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rgb = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const tint = (c, f) => 'rgb(' + rgb(c).map((v) => Math.max(0, Math.min(255, Math.round(v * f)))).join(',') + ')';
const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function sprite(g, rows, pal, x, y) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => { const c = pal[ch]; if (c) { g.fillStyle = c; g.fillRect(x + i, y + j, 1, 1); } }));
}
function line(g, x0, y0, x1, y1, c) {  // Bresenham
  g.fillStyle = c;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  for (let e = dx + dy; ;) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

// little golden key for the heading
function drawKeyIcon(cv) {
  cv.width = 16; cv.height = 6;
  sprite(cv.getContext('2d'), [
    '..YYY...........',
    '.YWYYy..........',
    'YW...yYYYYYYYYYY',
    'Yy...yyyyyyyyyyy',
    '.yyyyy.....yd.yd',
    '..ddd......yd.yd',
  ], { Y: '#ffd75e', W: '#fff3c0', y: '#c8902c', d: '#7a4e14' }, 0, 0);
}

// a dark brick tile for the page background (data: URL; CSS scales it up pixelated)
function wallTile() {
  const c = newCanvas(32, 16), g = c.getContext('2d');
  const tones = ['#1c1824', '#1f1a28', '#19151f', '#1d1926'];
  g.fillStyle = '#0f0c14'; g.fillRect(0, 0, 32, 16);
  for (let row = 0; row < 2; row++) {
    for (let k = -1; k < 2; k++) {        // the half brick at either edge of the odd row is one brick, wrapped
      const x = k * 16 + row * 8, y = row * 8;
      g.fillStyle = tones[row * 2 + ((k + 2) % 2)]; g.fillRect(x, y, 15, 7);
      g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(x, y, 15, 1);
      g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, y + 6, 15, 1);
    }
  }
  return c.toDataURL();
}

function makeScene(cv) {
  const W = SCENE_W, H = SCENE_H, N = W * H;
  cv.width = W; cv.height = H;
  const out = cv.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = () => performance.now() / 1000;

  // ---- geometry ---------------------------------------------------------------------------------------
  // The doorway spans x in [CX-HALF, CX+HALF), y in [TOP, FLOOR), with a round top above SPRING.
  const CX = 80, HALF = 22, DW = 2 * HALF, TOP = 40, SPRING = TOP + HALF, FLOOR = 102, DH = FLOOR - TOP;
  const RING = 8;                                      // thickness of the arch stones
  const TORCHES = [26, 134], FLAME_TOP = 18, CUP = 29;
  const RUNE_X = [64, 78, 92], RUNE_Y = 13;            // 5x7 glyphs on the tablet above the arch
  const GEM_Y = 34;                                    // the keystone's gem
  const openL = new Int16Array(H), openR = new Int16Array(H);  // the opening, row by row: [openL, openR)
  for (let y = TOP; y < FLOOR; y++) {
    const dy = SPRING - y - 0.5, half = y >= SPRING ? HALF : Math.sqrt(Math.max(0, HALF * HALF - dy * dy));
    openL[y] = Math.round(CX - half); openR[y] = Math.round(CX + half);
  }
  const inOpening = (x, y) => y >= TOP && y < FLOOR && x >= openL[y] && x < openR[y];

  const RUNES = [
    ['x.x.x', 'x.x.x', '.xxx.', '..x..', '..x..', '..x..', '..x..'],   // algiz
    ['..x..', '.x.x.', 'x...x', '.x.x.', '..x..', '.x.x.', 'x...x'],   // othala
    ['.x...', '.xx..', '.x.x.', '.x..x', '.x.x.', '.xx..', '.x...'],   // thurisaz
  ];
  const FLAMES = [
    ['...r...', '..rr...', '..rOr..', '.rOOr..', '.rOYOr.', 'rOYYOr.', 'rOYWYOr', 'rOYWYOr', '.rYWYr.', '.rOYOr.', '..rrr..'],
    ['....r..', '...rr..', '..rOr..', '..rOOr.', '.rOYOr.', '.rOYYOr', 'rOYWYOr', 'rOYWYOr', '.rYWYr.', '.rOYOr.', '..rrr..'],
    ['.......', '...r...', '..rOr..', '..rOr..', '.rOYOr.', '.rOYOr.', 'rOYWYOr', 'rOYWYOr', '.rYWYr.', '.rOYOr.', '..rrr..'],
    ['..r....', '..rr...', '.rOr...', '.rOOr..', '.rOYOr.', 'rOYYOr.', 'rOYWYOr', 'rOYWYOr', '.rYWYr.', '.rOYOr.', '..rrr..'],
  ];
  const FLAME_PAL = { r: '#d9481f', O: '#ff9a2e', Y: '#ffd04a', W: '#fff6c8' };

  // ---- the static background: wall, floor, arch, tablet, torches (unlit colours) ----------------------
  const bg = newCanvas(W, H), b = bg.getContext('2d'), R = rng(20261001);
  const fill = (x, y, w, h, c) => { b.fillStyle = c; b.fillRect(x, y, w, h); };
  const MORTAR = '#1c1826';

  function stone(x, y, w, h, c, f, cracks = true) {   // one block: lit top/left, shaded bottom/right, specks
    fill(x, y, w, h, tint(c, f));
    fill(x, y, w, 1, tint(c, f * 1.2));
    fill(x, y + 1, 1, h - 1, tint(c, f * 1.08));
    fill(x, y + h - 1, w, 1, tint(c, f * 0.74));
    fill(x + w - 1, y + 1, 1, h - 1, tint(c, f * 0.84));
    for (let n = (w * h) / 16; n > 0; n--) {
      fill(x + 1 + Math.floor(R() * (w - 2)), y + 1 + Math.floor(R() * (h - 2)), 1, 1, tint(c, f * (R() < 0.5 ? 0.8 : 1.12)));
    }
    if (cracks && w > 8 && R() < 0.16) {                  // a hairline crack running down the block
      for (let cx = x + 2 + Math.floor(R() * (w - 4)), cy = y + 1; cy < y + h - 1 && cx > x && cx < x + w - 1; cy++) {
        fill(cx, cy, 1, 1, tint(c, f * 0.55));
        if (R() < 0.45) cx += R() < 0.5 ? -1 : 1;
      }
    }
  }
  function moss(x, y, w) {
    for (let i = 0; i < w; i++) {
      if (R() < 0.5) fill(x + i, y, 1, 1, R() < 0.5 ? '#4f7f3c' : '#3b6431');
      if (R() < 0.16) fill(x + i, y + 1, 1, 1 + Math.floor(R() * 3), '#2f5228');
    }
  }

  // wall: courses of rough blocks
  const WALL = ['#5a5370', '#524b67', '#605977', '#4c4660'];
  fill(0, 0, W, FLOOR, MORTAR);
  for (let y = 0; y < FLOOR; y += 8) {
    for (let x = -Math.floor(R() * 12); x < W;) {
      const w = 10 + Math.floor(R() * 12);
      stone(x, y, w - 1, 7, WALL[Math.floor(R() * WALL.length)], 0.9 + R() * 0.18);
      if (y >= FLOOR - 26 && R() < 0.4) moss(x, y, w - 1);
      x += w;
    }
  }
  // soot above the torches
  for (const tx of TORCHES) {
    for (let y = 1; y < 18; y++) for (let x = tx - 5; x <= tx + 5; x++) {
      if (R() < 0.6 * (1 - Math.abs(x - tx) / 6) * (y / 17)) fill(x, y, 1, 1, 'rgba(8,6,12,.4)');
    }
  }
  // a cobweb in the top-left corner
  const WEB = 'rgba(176,170,196,.55)';
  for (const [x, y] of [[19, 0], [15, 9], [7, 15], [0, 20]]) line(b, 0, 0, x, y, WEB);
  for (const r of [5, 10, 15]) {
    for (let a = 0.04; a < 1.53; a += 0.75 / r) {
      const sag = Math.sin(a * 4) * 0.8;
      if (R() > 0.12) fill(Math.round((r - sag) * Math.cos(a) * 1.15), Math.round((r - sag) * Math.sin(a) * 1.05), 1, 1, WEB);
    }
  }

  // floor: flagstones in rows that get taller as they come closer, joints converging on the doorway
  const FL = ['#4d465c', '#463f54', '#524a62', '#433d50'];
  const bands = [FLOOR, FLOOR + 5, FLOOR + 11, H];
  for (let bi = 0; bi < 3; bi++) {
    for (let y = bands[bi]; y < bands[bi + 1]; y++) {
      const s = (13 * (y - 58)) / (FLOOR - 58), off = ((bi & 1) * s) / 2;
      for (let x = 0; x < W; x++) {
        const u = (x - CX + off) / s, k = Math.floor(u), c = FL[(((k * 7 + bi * 3) % 4) + 4) % 4];
        if (y === bands[bi]) fill(x, y, 1, 1, '#191520');
        else if ((u - k) * s < 1) fill(x, y, 1, 1, '#211c2b');
        else fill(x, y, 1, 1, y === bands[bi] + 1 ? tint(c, 1.15) : R() < 0.06 ? tint(c, 0.82) : c);
      }
    }
  }
  fill(0, FLOOR - 2, W, 2, 'rgba(0,0,0,.28)');            // where the wall meets the floor

  // the arch: jambs of alternating short/long quoins, then a ring of voussoirs with a keystone
  const ARCH = '#6d6684';
  for (let i = 0, y = SPRING; y < FLOOR; i++, y += 8) {
    const wq = i & 1 ? RING + 3 : RING, h = Math.min(8, FLOOR - y), f = 0.95 + R() * 0.12;
    fill(CX - HALF - wq - 1, y, wq + 1, h, MORTAR); stone(CX - HALF - wq, y, wq, h - 1, ARCH, f, false);
    fill(CX + HALF, y, wq + 1, h, MORTAR); stone(CX + HALF, y, wq, h - 1, ARCH, f * 0.97, false);
    fill(CX - HALF, y, 1, h - 1, tint(ARCH, 0.6 * f)); fill(CX + HALF, y, 1, h - 1, tint(ARCH, 0.68 * f)); // reveal
  }
  const SEGS = 9, segF = Array.from({ length: SEGS }, () => 0.94 + R() * 0.14);
  for (let y = SPRING - HALF - RING - 5; y < SPRING; y++) {
    for (let x = CX - HALF - RING - 1; x <= CX + HALF + RING; x++) {
      if (inOpening(x, y)) continue;
      const dx = x + 0.5 - CX, dy = SPRING - (y + 0.5), r = Math.hypot(dx, dy);
      if (r < HALF - 1) continue;
      const pos = ((Math.PI - Math.atan2(dy, dx)) / Math.PI) * SEGS, seg = Math.min(SEGS - 1, Math.max(0, Math.floor(pos)));
      const outer = HALF + RING + (seg === 4 ? 3 : 0);
      if (r >= outer + 1) continue;
      if (r >= outer || (seg > 0 && (pos - seg) * ((r * Math.PI) / SEGS) < 1)) { fill(x, y, 1, 1, MORTAR); continue; }
      const t = (r - HALF) / (outer - HALF), f = segF[seg];
      fill(x, y, 1, 1, tint(ARCH, f * (t < 0.14 ? 0.62 : t > 0.86 ? 1.16 : R() < 0.08 ? 0.85 : 1)));
    }
  }
  fill(CX - 1, GEM_Y - 1, 3, 3, '#2a2436'); fill(CX, GEM_Y - 2, 1, 5, '#2a2436'); fill(CX - 2, GEM_Y, 5, 1, '#2a2436');
  fill(CX, GEM_Y, 1, 1, '#6a5a80');                       // the dull gem, lit up once the gate opens

  // the tablet with three carved runes
  fill(57, 8, 46, 18, MORTAR);
  stone(58, 9, 44, 16, '#736c8a', 1, false);
  fill(60, 11, 40, 1, tint('#736c8a', 0.7)); fill(60, 11, 1, 12, tint('#736c8a', 0.7));  // recessed panel
  fill(60, 22, 40, 1, tint('#736c8a', 1.2)); fill(99, 11, 1, 12, tint('#736c8a', 1.2));
  RUNES.forEach((g, r) => {
    sprite(b, g.map((row) => row.replace(/x/g, 'h')), { h: tint('#736c8a', 1.25) }, RUNE_X[r] + 1, RUNE_Y + 1);
    sprite(b, g, { x: '#211b2d' }, RUNE_X[r], RUNE_Y);
  });

  // wall torches: plate, handle, iron cup (the flame is emissive, drawn per frame)
  for (const tx of TORCHES) {
    fill(tx - 2, 37, 5, 8, '#24222c'); fill(tx - 1, 38, 3, 6, '#4a4858'); fill(tx - 1, 38, 3, 1, '#6e6c80');
    fill(tx - 1, CUP + 1, 3, 14, '#6b4325'); fill(tx - 1, CUP + 1, 1, 14, '#8a5a32'); fill(tx + 1, CUP + 1, 1, 14, '#4a2c16');
    fill(tx - 2, 40, 5, 1, '#3a3846');
    fill(tx - 3, CUP, 7, 2, '#5c5a6c'); fill(tx - 3, CUP, 7, 1, '#8c8aa0'); fill(tx - 2, CUP + 2, 5, 1, '#3a3846');
  }
  for (let y = TOP; y < FLOOR; y++) fill(openL[y], y, openR[y] - openL[y], 1, '#0b0910');
  const bgPx = b.getImageData(0, 0, W, H).data;

  // ---- the double door, as an offscreen sprite (one copy with the right ring pull lifted) --------------
  function doorArt(lifted) {
    const c = newCanvas(DW, DH), g = c.getContext('2d'), Rd = rng(42);
    const f = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    const WOOD = ['#7d5434', '#714b2e', '#88603c', '#6c4729', '#7a5232', '#835a37'];
    let x = 0;
    [7, 7, 8, 8, 7, 7].forEach((w, p) => {
      const c0 = WOOD[p];
      f(x, 0, w, DH, c0); f(x, 0, 1, DH, tint(c0, 1.18)); f(x + w - 1, 0, 1, DH, '#2a180c');
      for (let n = 0; n < 6; n++) {                            // grain
        f(x + 1 + Math.floor(Rd() * (w - 2)), Math.floor(Rd() * DH), 1, 4 + Math.floor(Rd() * 14), tint(c0, 0.78));
      }
      if (Rd() < 0.7) {                                         // a knot
        const kx = x + 2 + Math.floor(Rd() * (w - 4)), ky = 4 + Math.floor(Rd() * (DH - 10));
        f(kx - 1, ky, 3, 2, tint(c0, 0.72)); f(kx, ky, 1, 1, tint(c0, 0.5));
      }
      x += w;
    });
    for (const by of [12, DH - 16]) {                           // iron straps with rivets, one per leaf
      for (const [sx, sw] of [[0, HALF - 1], [HALF + 1, HALF - 1]]) {
        f(sx, by, sw, 4, '#4b4a58'); f(sx, by, sw, 1, '#7c7b8e'); f(sx, by + 3, sw, 1, '#26252e');
        for (let rx = sx + 2; rx < sx + sw - 1; rx += 5) { f(rx, by + 1, 1, 1, '#a9a8bc'); f(rx, by + 2, 1, 1, '#2e2d38'); }
      }
    }
    f(HALF - 1, 0, 2, DH, '#1e1209');                           // the seam between the leaves
    for (const [rx, up] of [[HALF - 6, false], [HALF + 2, lifted]]) {    // ring pulls
      f(rx + 1, 31, 2, 2, '#8c8aa0'); f(rx + 1, 33, 2, 1, '#3a3846');
      if (up) sprite(g, ['.oo.', 'o..o', '.oo.'], { o: '#c9c7da' }, rx, 28);
      else sprite(g, ['.oo.', 'o..o', 'o..o', 'O..O', '.OO.'], { o: '#a9a7bc', O: '#5d5b6e' }, rx, 33);
    }
    f(0, DH - 1, DW, 1, '#1a1008');                             // threshold
    for (let y = 0; y < DH; y++) {                              // cut to the arch, shadow under its curve
      const l = openL[y + TOP] - (CX - HALF), r = openR[y + TOP] - (CX - HALF);
      g.clearRect(0, y, l, 1); g.clearRect(r, y, DW - r, 1);
    }
    for (let xx = 0; xx < DW; xx++) {
      let y = 0;
      while (y < DH && !(xx + CX - HALF >= openL[y + TOP] && xx + CX - HALF < openR[y + TOP])) y++;
      f(xx, y, 1, 2, 'rgba(0,0,0,.4)'); f(xx, y + 2, 1, 1, 'rgba(0,0,0,.18)');
    }
    return c;
  }
  const DOOR = [doorArt(false), doorArt(true)];
  const leaf = newCanvas(DW, DH), lg = leaf.getContext('2d', { willReadFrequently: true });
  lg.imageSmoothingEnabled = false;
  let leafPx = null, leafKey = '';
  function leaves(e, lifted) {         // the two leaves swung in by e (0..1), squashed towards their hinges
    const key = e.toFixed(3) + lifted;
    if (key === leafKey) return leafPx;
    const src = DOOR[lifted ? 1 : 0];
    lg.clearRect(0, 0, DW, DH);
    if (e <= 0) lg.drawImage(src, 0, 0);
    else {
      const w = Math.max(2, Math.round(HALF * (1 - 0.84 * e)));
      lg.drawImage(src, 0, 0, HALF, DH, 0, 0, w, DH);
      lg.drawImage(src, HALF, 0, HALF, DH, DW - w, 0, w, DH);
    }
    leafKey = key;
    return (leafPx = lg.getImageData(0, 0, DW, DH).data);
  }

  // what is behind the door: warm light and a stair leading up into it (emissive)
  const RAMP = ['#8f4a22', '#b8642c', '#da8c3c', '#f1b456', '#ffd682', '#ffecb4', '#fff9e4'].map(rgb);
  const inside = new Uint8Array(N * 3);
  for (let y = TOP; y < FLOOR; y++) {
    for (let x = openL[y]; x < openR[y]; x++) {
      const d = Math.hypot((x + 0.5 - CX) * 1.15, (y + 0.5 - (FLOOR - 16)) * 0.9);
      let lv = Math.max(0, 1 - d / 34) * (RAMP.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] - 0.5;
      const step = (FLOOR - 1 - y) / 3;
      if (step < 4 && Number.isInteger(step) && Math.abs(x + 0.5 - CX) < HALF - 1 - 3 * step) lv -= 2;   // stair edges
      const c = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(lv)))], i = (y * W + x) * 3;
      inside[i] = c[0]; inside[i + 1] = c[1]; inside[i + 2] = c[2];
    }
  }

  // ---- light maps ---------------------------------------------------------------------------------------
  const fall = (d, r) => (d >= r ? 0 : Math.pow(1 - d / r, 1.7));
  const mapOf = (fn) => { const m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = fn(i % W, (i / W) | 0); return m; };
  const torchMap = TORCHES.map((tx) => mapOf((x, y) => fall(Math.hypot(x + 0.5 - tx - 0.5, (y + 0.5 - 24) * 1.1), 72)));
  const runeMap = RUNE_X.map((rx) => mapOf((x, y) => fall(Math.hypot(x + 0.5 - rx - 2.5, y + 0.5 - RUNE_Y - 3.5), 15)));
  const doorMap = mapOf((x, y) => {
    const dx = Math.max(CX - HALF - x - 0.5, 0, x + 0.5 - CX - HALF), dy = Math.max(TOP - y - 0.5, 0, y + 0.5 - FLOOR);
    let v = fall(Math.hypot(dx, dy * 1.5), 62) + 0.9 * fall(Math.hypot(x + 0.5 - CX, y + 0.5 - GEM_Y), 13);
    if (y >= FLOOR && Math.abs(x + 0.5 - CX) < HALF + (y - FLOOR) * 1.3) v += 0.55 * (1 - ((y - FLOOR) / (H - FLOOR)) * 0.6);
    return v;
  });
  // a soft fill from where the viewer stands, so the floor and the door aren't lost in the dark
  const fillMap = mapOf((x, y) => fall(Math.hypot((x + 0.5 - CX) * 0.8, y + 0.5 - 150), 125));
  const AMB = [0.16, 0.15, 0.24], FILL_C = [0.5, 0.42, 0.46], TORCH_C = [1.05, 0.7, 0.4], DOOR_C = [1.1, 0.86, 0.5];
  const BANDS = 6, LMAX = 1.45;
  const RUNE_C = { cyan: [0.3, 0.85, 1.0], gold: [1.0, 0.78, 0.35], red: [1.2, 0.25, 0.2] };

  // ---- state ----------------------------------------------------------------------------------------------
  let lit = 0, opened = false, openAt = 0, openP = 0, badUntil = 0, ringUntil = 0;
  let flashAt = [-9, -9, -9], parts = [];
  const torches = TORCHES.map(() => ({ frame: 0, next: 0, lum: 1, target: 1 }));
  const img = out.createImageData(W, H), px = img.data;
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const rand = (a, z) => a + Math.random() * (z - a);

  function step(now, dt) {
    for (const t of torches) {
      if (now >= t.next) {
        t.frame = (t.frame + 1 + Math.floor(Math.random() * 3)) % FLAMES.length;
        t.target = 0.8 + Math.random() * 0.28;
        t.next = now + (reduced ? 0.5 : rand(0.07, 0.16));
      }
      t.lum += (t.target - t.lum) * Math.min(1, dt * 12);
    }
    openP = opened ? (reduced ? 1 : Math.min(1, (now - openAt) / 1.4)) : 0;
    if (reduced) { parts = []; return; }
    for (const tx of TORCHES) {
      if (Math.random() < dt * 2.5) parts.push({ k: 'ember', x: tx + rand(-1.5, 1.5), y: FLAME_TOP + 3, vx: rand(-3, 3), vy: rand(-22, -10), t: 0, life: rand(0.5, 1.2) });
    }
    if (opened && openP > 0.2) {
      const w = HALF * (1 - 0.84 * ease(openP));
      for (let n = Math.random() < dt * 14 ? 1 : 0; n > 0; n--) {
        const x = rand(CX - HALF + w, CX + HALF - w), y = rand(TOP + 6, FLOOR - 2);
        if (inOpening(x | 0, y | 0)) parts.push({ k: 'spark', x, y, vx: (x - CX) * 0.35 + rand(-2, 2), vy: rand(-9, -3), t: 0, life: rand(1, 2.2) });
      }
    }
    for (const p of parts) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'ember') p.vx += Math.sin(p.t * 9 + p.x) * 12 * dt;
      if (p.k === 'dust') p.vy += 40 * dt;
    }
    parts = parts.filter((p) => p.t < p.life && p.y > -2 && p.y < H);
  }

  function draw(now) {
    const e = ease(openP), bad = now < badUntil;
    const doorPx = leaves(e, now < ringUntil), dim = 1 - 0.55 * e, glow = Math.min(1, 0.45 + e);
    const t0 = torches[0].lum, t1 = torches[1].lum, dl = e * 1.0;
    const rc = bad ? RUNE_C.red : opened ? RUNE_C.gold : RUNE_C.cyan;
    const ri = RUNE_X.map((_, r) => (bad ? 1 : opened ? 0.9 : r < lit ? 0.7 + 1.1 * Math.max(0, 1 - (now - flashAt[r]) / 0.35) : 0));

    for (let y = 0, i = 0; y < H; y++) {
      const rowL = y >= TOP && y < FLOOR ? openL[y] : 0, rowR = y >= TOP && y < FLOOR ? openR[y] : 0;
      for (let x = 0; x < W; x++, i++) {
        const k = i * 4;
        let sr = bgPx[k], sg = bgPx[k + 1], sb = bgPx[k + 2];
        if (x >= rowL && x < rowR) {
          const d = ((y - TOP) * DW + (x - CX + HALF)) * 4;
          if (doorPx[d + 3]) { sr = doorPx[d] * dim; sg = doorPx[d + 1] * dim; sb = doorPx[d + 2] * dim; }
          else if (e > 0) {                         // the doorway itself glows: no lighting
            const j = i * 3;
            px[k] = inside[j] * glow; px[k + 1] = inside[j + 1] * glow; px[k + 2] = inside[j + 2] * glow; px[k + 3] = 255;
            continue;
          }
        }
        const tl = torchMap[0][i] * t0 + torchMap[1][i] * t1;
        const rl = runeMap[0][i] * ri[0] + runeMap[1][i] * ri[1] + runeMap[2][i] * ri[2];
        const dd = doorMap[i] * dl, fl = fillMap[i], th = BAYER[(y & 3) * 4 + (x & 3)];
        const lr = AMB[0] + fl * FILL_C[0] + tl * TORCH_C[0] + rl * rc[0] + dd * DOOR_C[0];
        const lgr = AMB[1] + fl * FILL_C[1] + tl * TORCH_C[1] + rl * rc[1] + dd * DOOR_C[1];
        const lb = AMB[2] + fl * FILL_C[2] + tl * TORCH_C[2] + rl * rc[2] + dd * DOOR_C[2];
        px[k] = sr * Math.min(LMAX, Math.floor(lr * BANDS + th) / BANDS);
        px[k + 1] = sg * Math.min(LMAX, Math.floor(lgr * BANDS + th) / BANDS);
        px[k + 2] = sb * Math.min(LMAX, Math.floor(lb * BANDS + th) / BANDS);
        px[k + 3] = 255;
      }
    }
    out.putImageData(img, 0, 0);

    // emissive: flames, runes, gem, particles
    TORCHES.forEach((tx, n) => sprite(out, FLAMES[torches[n].frame], FLAME_PAL, tx - 3, FLAME_TOP));
    RUNES.forEach((g, r) => {
      if (!(bad || opened || r < lit)) return;
      const flash = !bad && !opened && now - flashAt[r] < 0.15;
      sprite(out, g, { x: flash ? '#ffffff' : bad ? '#ff6a5a' : opened ? '#ffe27a' : '#8ff6ff' }, RUNE_X[r], RUNE_Y);
    });
    if (opened) {
      out.fillStyle = '#ffd75e'; out.fillRect(CX - 1, GEM_Y - 1, 3, 3); out.fillRect(CX, GEM_Y - 2, 1, 5); out.fillRect(CX - 2, GEM_Y, 5, 1);
      out.fillStyle = '#fff8d8'; out.fillRect(CX, GEM_Y, 1, 1);
    }
    for (const p of parts) {
      const a = p.t / p.life;
      if (p.k === 'ember') out.fillStyle = a < 0.4 ? '#ffe08a' : a < 0.7 ? '#ff9a2e' : '#b8401e';
      else if (p.k === 'dust') out.fillStyle = a < 0.5 ? '#9a92a8' : '#6a6478';
      else {
        out.fillStyle = Math.sin(p.t * 11 + p.x) > 0 ? '#fffbe6' : '#ffd75e';
        if (a > 0.35 && a < 0.5) { out.fillRect((p.x | 0) - 1, p.y | 0, 3, 1); out.fillRect(p.x | 0, (p.y | 0) - 1, 1, 3); continue; }
      }
      out.fillRect(p.x | 0, p.y | 0, 1, 1);
    }
  }

  let last = -1;
  function loop(ms) {
    requestAnimationFrame(loop);
    const now = ms / 1000;
    if (last >= 0 && now - last < 1 / 30) return;     // pixel art doesn't need more than 30 fps
    step(now, last < 0 ? 0 : Math.min(0.1, now - last));
    last = now;
    draw(now);
  }
  requestAnimationFrame(loop);

  // Scale by whole device pixels when that fills most of the frame, so every art pixel is the same size.
  function fit() {
    const dpr = window.devicePixelRatio || 1, avail = cv.parentElement.clientWidth;
    const s = Math.floor((avail * dpr) / W), w = s >= 1 && (s * W) / dpr >= avail * 0.85 ? (s * W) / dpr : avail;
    cv.style.width = w + 'px'; cv.style.height = (w * H) / W + 'px';
  }
  fit();
  if (window.ResizeObserver) new ResizeObserver(fit).observe(cv.parentElement); else addEventListener('resize', fit);

  return {
    reset() {
      lit = 0; opened = false; openP = 0; badUntil = 0; flashAt = [-9, -9, -9];
      parts = parts.filter((p) => p.k === 'ember');
      cv.classList.remove('shake');
    },
    knock(i) {
      const now = clock();
      lit = i + 1; flashAt[i] = now; ringUntil = now + 0.14;
      if (!reduced) {
        for (let n = 0; n < 7; n++) parts.push({ k: 'dust', x: CX + 4 + rand(-2, 2), y: TOP + 37, vx: rand(-14, 14), vy: rand(-16, -4), t: 0, life: rand(0.35, 0.7) });
      }
    },
    open() { lit = 3; opened = true; openAt = clock(); },
    fail() {
      badUntil = clock() + 0.7; lit = 0;
      if (!reduced) { cv.classList.remove('shake'); void cv.offsetWidth; cv.classList.add('shake'); }
    },
  };
}
