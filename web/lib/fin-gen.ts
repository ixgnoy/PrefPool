// @ts-nocheck
// Verbatim copy of docs/design/fin-gen.js (pure pixel-grid generator). Only the export line changed.
// Fin sprite generator, size-aware. All geometry is authored in 32-space and scaled to N (32 | 48 | 64).
// Bigger sizes spend their extra pixels on detail (eyebrows, mouth shapes, fin rays, scales, shading),
// not just a bigger silhouette. Pure functions: usable in the browser and in Node for checks.
const C = { K: '#13203d', B: '#9dbcf6', S: '#7f9fe8', L: '#eef4ff', F: '#2f5fd7', f: '#244bb0', W: '#ffffff', P: '#f39a8f',
  T: '#b9783f', t: '#7a4a24', Y: '#f2c14e', y: '#c98a16', R: '#d6453d', G: '#23905a', c: '#fff6df', g: '#9aa6b8', a: '#a8e0ff', w: '#e9f6ff' };

const mk = (w, h) => Array.from({ length: h }, () => Array(w).fill(null));
const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
function outlined(g, col = 'K') { const h = g.length, w = g[0].length, o = g.map((r) => r.slice()); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!g[y][x]) { if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx])) o[y][x] = col; } return o; }
function stack(layers) { const out = mk(layers[0][0].length, layers[0].length); layers.forEach((l) => l.forEach((r, y) => r.forEach((v, x) => { if (v) out[y][x] = v; }))); return out; }

/** A canvas-like pen bound to a grid of size N, taking 32-space coordinates. */
function pen(N) {
  const s = N / 32;
  const g = mk(N, N);
  const set = (x, y, col) => { if (y >= 0 && y < N && x >= 0 && x < N) g[y][x] = col; };
  return {
    g, s,
    poly(pts, col, dx = 0, dy = 0) { const P = pts.map(([x, y]) => [(x + dx) * s, (y + dy) * s]); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inPoly(x + .5, y + .5, P)) g[y][x] = col; },
    ell(cx, cy, rx, ry, col, onlyOver = null) { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = ((x + .5 - cx * s) / (rx * s)) ** 2 + ((y + .5 - cy * s) / (ry * s)) ** 2; if (d <= 1 && (!onlyOver || onlyOver.includes(g[y][x]))) g[y][x] = col; } },
    rect(x0, y0, x1, y1, col) { for (let y = Math.round(y0 * s); y < Math.round(y1 * s); y++) for (let x = Math.round(x0 * s); x < Math.round(x1 * s); x++) set(x, y, col); },
    /** 1-px polyline through 32-space points (Bresenham), whatever the size: details get finer as N grows. */
    line(pts, col) {
      for (let i = 0; i + 1 < pts.length; i++) {
        let [x0, y0] = pts[i].map((v) => Math.round(v * s)), [x1, y1] = pts[i + 1].map((v) => Math.round(v * s));
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
        for (;;) { set(x0, y0, col); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
      }
    },
    dot(x, y, col) { set(Math.round(x * s), Math.round(y * s), col); },
    /** set every pixel whose centre (in 32-space) satisfies pred, but only over existing pixels */
    fillIf(pred, col) { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] && pred((x + .5) / s, (y + .5) / s)) g[y][x] = col; },
  };
}

const TAILS = [[[8, 17], [1, 9], [4, 17], [1, 25]], [[8, 17], [2, 11], [4, 17], [0, 23]], [[8, 17], [0, 11], [3, 17], [2, 23]]];

/** Fin as outlined layers. o: dx, dy, tail (0-2), eye (open|closed|happy|peek), brow, mouth, hand ([x,y] | null), satchel */
function fin(N, o = {}) {
  const { dx = 0, dy = 0, tail = 0, eye = 'open', brow = 'none', mouth = 'smile', hand = [16, 21], satchel = true, sx = 1, sy = 1 } = o;
  const top = 8.2 * (1 - sy); // squash (sy < 1) lowers the top while the belly stays planted
  const d = N >= 64 ? 2 : N >= 48 ? 1 : 0; // detail level
  const p = pen(N);
  const X = (x) => x + dx, Yy = (y) => y + dy;
  p.poly(TAILS[tail], 'F', dx, dy);
  p.poly([[12, 10], [14.5, 5.5], [18.5, 6], [20, 10]], 'F', dx, dy + top);
  if (d >= 1) { // fin rays
    p.line([[X(14), Yy(9.6 + top)], [X(15), Yy(6.6 + top)]], 'f'); p.line([[X(16.6), Yy(9.6 + top)], [X(17), Yy(6.4 + top)]], 'f');
    const tr = TAILS[tail]; p.line([[X(7), Yy(17)], [X((tr[1][0] + 7) / 2 + 0.5), Yy((tr[1][1] + 17) / 2)]], 'f'); p.line([[X(7), Yy(17)], [X((tr[3][0] + 7) / 2 + 0.5), Yy((tr[3][1] + 17) / 2)]], 'f');
  }
  p.ell(X(16), Yy(17 + top), 10.6 * sx, 8.2 * sy, 'B');
  if (d >= 2) { p.ell(X(16), Yy(19.6 + top), 10.2 * sx, 6.3 * sy, 'S', ['B']); p.ell(X(16), Yy(16.3 + top), 10.3 * sx, 7.5 * sy, 'B', ['S']); } // underside shadow crescent
  p.ell(X(18), Yy(21 + top * 0.5), 7.6 * sx, 3.4 * sy, 'L', ['B', 'S']);
  // scales
  const arc = (x, y) => p.line([[X(x), Yy(y + 0.8)], [X(x + 0.8), Yy(y)], [X(x + 1.6), Yy(y + 0.8)]], 'S');
  if (d === 0) { p.dot(X(9), Yy(15), 'S'); p.dot(X(10), Yy(14), 'S'); p.dot(X(11), Yy(15), 'S'); }
  else { arc(13.5, 13); arc(15.5, 15); if (d >= 2) { arc(13.5, 17); arc(17.5, 12.5); arc(11.5, 15.6); } }
  if (d >= 1) p.line([[X(9.4), Yy(12.6)], [X(11), Yy(11.2)], [X(12.6), Yy(10.6)]], 'W'); // back highlight
  // eye
  const ex = d === 0 ? X(20.6) : X(20.2), ey = (d === 0 ? Yy(13.8) : Yy(14.7)) + top * 0.6;
  if (eye === 'open' || eye === 'peek') {
    if (d === 0) {
      const x0 = X(18), y0 = Yy(11);
      p.rect(x0 + 1, y0, x0 + 5, y0 + 1, 'K'); p.rect(x0 + 1, y0 + 5, x0 + 5, y0 + 6, 'K'); p.rect(x0, y0 + 1, x0 + 1, y0 + 5, 'K'); p.rect(x0 + 5, y0 + 1, x0 + 6, y0 + 5, 'K');
      p.rect(x0 + 1, y0 + 1, x0 + 5, y0 + 5, 'W'); p.rect(x0 + 3, y0 + 2, x0 + 5, y0 + 4, 'K'); p.dot(x0 + 3, y0 + 2, 'W');
    } else {
      p.ell(ex, ey, 3.3, 3.5, 'K'); p.ell(ex, ey, 2.55, 2.75, 'W'); p.ell(ex + 0.8, ey + 0.3, 1.45, 1.75, 'K');
      p.ell(ex + 0.35, ey - 0.45, 0.62, 0.62, 'W'); if (d >= 2) p.dot(ex + 1.5, ey + 1.2, 'W');
    }
  } else if (eye === 'wide') {
    if (d === 0) { const x0 = X(18), y0 = Yy(11) + top * 0.6; p.rect(x0, y0, x0 + 6, y0 + 6, 'K'); p.rect(x0 + 1, y0 + 1, x0 + 5, y0 + 5, 'W'); p.rect(x0 + 3, y0 + 2, x0 + 4, y0 + 4, 'K'); }
    else { p.ell(ex, ey - 0.3, 3.7, 3.9, 'K'); p.ell(ex, ey - 0.3, 2.95, 3.15, 'W'); p.ell(ex + 0.5, ey, 1.15, 1.45, 'K'); p.dot(ex + 0.2, ey - 0.6, 'W'); p.dot(ex - 1.4, ey + 1.2, 'W'); }
  } else if (eye === 'firm') {
    if (d === 0) { const x0 = X(18), y0 = Yy(11) + top * 0.6; p.rect(x0, y0 + 2, x0 + 6, y0 + 6, 'K'); p.rect(x0 + 1, y0 + 3, x0 + 5, y0 + 5, 'W'); p.rect(x0 + 3, y0 + 3, x0 + 5, y0 + 5, 'K'); }
    else {
      p.ell(ex, ey, 3.3, 3.5, 'K'); p.ell(ex, ey, 2.55, 2.75, 'W'); p.ell(ex + 0.8, ey + 0.5, 1.45, 1.55, 'K');
      p.fillIf((x, y) => y < ey - 0.4 && ((x - ex) / 3.4) ** 2 + ((y - ey) / 3.6) ** 2 <= 1, 'B'); // heavy upper lid
      p.line([[ex - 3, ey - 0.4], [ex + 3, ey - 0.4]], 'K');
    }
  } else if (eye === 'closed') {
    p.line([[ex - 2.2, ey + 0.2], [ex, ey + 0.9], [ex + 2.2, ey + 0.2]], 'K');
  } else if (eye === 'happy') {
    p.line([[ex - 2.2, ey + 0.9], [ex, ey - 1.1], [ex + 2.2, ey + 0.9]], 'K');
  }
  if (d >= 1 && brow !== 'none') {
    const b = { up: [[ex - 1.6, ey - 4.3], [ex + 1.4, ey - 4.9]], worried: [[ex - 1.6, ey - 3.9], [ex + 1.6, ey - 5.0]], happy: [[ex - 1.6, ey - 4.0], [ex, ey - 4.6], [ex + 1.6, ey - 4.0]], firm: [[ex - 1.8, ey - 4.6], [ex + 2.0, ey - 2.9]] }[brow];
    p.line(b, 'K'); if (brow === 'firm') p.line(b.map(([x, y]) => [x, y - 0.7]), 'K');
  }
  // cheek + mouth
  const fy = top * 0.4;
  if (d === 0) { p.dot(X(20), Yy(18 + fy), 'P'); p.dot(X(21), Yy(18 + fy), 'P'); } else p.ell(X(19.4), Yy(19.4 + fy), mouth === 'grin' ? 1.8 : 1.4, mouth === 'grin' ? 0.9 : 0.7, 'P');
  const m = {
    smile: d === 0 ? [[X(24), Yy(19 + fy)], [X(25), Yy(18 + fy)]] : [[X(22.6), Yy(19.4 + fy)], [X(23.6), Yy(20.1 + fy)], [X(24.8), Yy(19.2 + fy)]],
    grin: [[X(22.4), Yy(19.0 + fy)], [X(23.6), Yy(20.6 + fy)], [X(25.0), Yy(18.9 + fy)]],
    flat: d === 0 ? [[X(23.6), Yy(19.2 + fy)], [X(25.4), Yy(19.2 + fy)]] : [[X(22.8), Yy(19.8 + fy)], [X(24.6), Yy(19.8 + fy)]],
  }[mouth] || null;
  if (mouth === 'o') { if (d === 0) p.rect(X(24), Yy(18.4 + fy), X(25.4), Yy(20 + fy), 'K'); else { p.ell(X(23.6), Yy(19.9 + fy), 1.25, 1.45, 'K'); p.ell(X(23.6), Yy(20.3 + fy), 0.6, 0.6, 'R'); } }
  else if (mouth === 'open') { if (d === 0) p.dot(X(24.5), Yy(18.7), 'K'); else { p.ell(X(23.6), Yy(19.7), 0.9, 1.0, 'K'); if (d >= 2) p.dot(X(23.6), Yy(20.1), 'R'); } }
  else if (m) p.line(m, 'K');
  if (mouth === 'grin' && d >= 1) p.ell(X(23.6), Yy(19.6 + fy), 0.8, 0.45, 'R', ['B', 'L', 'S']);
  if (satchel) p.line([[X(14), Yy(10)], [X(13.2), Yy(11.8)], [X(12.4), Yy(14)]], 't');
  const layers = [outlined(p.g)];
  if (satchel) {
    const q = pen(N);
    q.rect(X(8), Yy(15), X(12), Yy(19), 'T'); q.rect(X(8), Yy(15), X(12), Yy(16.2), 't');
    if (d >= 1) { q.rect(X(9.6), Yy(15.8), X(10.6), Yy(17), 'Y'); q.line([[X(8.4), Yy(18.4)], [X(11.4), Yy(18.4)]], 't'); } else q.dot(X(10), Yy(16), 'Y');
    layers.push(outlined(q.g));
  }
  if (hand) {
    const h = pen(N); h.ell(hand[0] + dx, hand[1] + dy, 2.8, 1.9, 'F');
    if (d >= 1) h.line([[hand[0] + dx - 1.6, hand[1] + dy], [hand[0] + dx + 1.4, hand[1] + dy - 0.2]], 'f');
    layers.push(outlined(h.g));
  }
  return layers;
}

// ---------- props (32-space geometry; 1-px details at every size) ----------
const prop = (N, fn) => { const p = pen(N); fn(p, N >= 64 ? 2 : N >= 48 ? 1 : 0); return outlined(p.g); };
const clipboard = (N, ox = 0, oy = 0) => prop(N, (p, d) => {
  const r = (x0, y0, x1, y1, c) => p.rect(x0 + ox, y0 + oy, x1 + ox, y1 + oy, c), l = (pts, c) => p.line(pts.map(([x, y]) => [x + ox, y + oy]), c);
  r(23, 21, 30, 30.6, 'T'); r(24, 22.6, 29, 29.6, 'c'); r(25, 20.2, 28, 21.8, 'g');
  [24.4, 26.2, 28].forEach((y) => l([[26, y], [28.2, y]], 'S'));
  l([[24.2, 24.4], [24.7, 25], [25.4, 23.8]], 'G'); l([[24.2, 26.2], [24.7, 26.8], [25.4, 25.6]], 'G');
  if (d >= 1) l([[24.2, 28], [25.2, 28]], 'g');
});
const exclaim = (N, oy = 0) => prop(N, (p) => { p.rect(28.6, 1.4 + oy, 30.4, 6.6 + oy, 'Y'); p.rect(28.6, 7.6 + oy, 30.4, 9.4 + oy, 'Y'); });
const pop = (N, on) => { const p = pen(N); if (on) { p.line([[25.4, 4.2], [24.2, 2.6]], 'Y'); p.line([[31.2, 10.4], [32, 9.6]], 'Y'); p.line([[22.6, 7.6], [21.2, 7]], 'Y'); } return p.g; };
const impact = (N) => { const p = pen(N); p.line([[31, 13], [32, 12]], 'Y'); p.line([[31.4, 16.4], [32.4, 16.4]], 'Y'); p.line([[31, 20], [32, 21]], 'Y'); return p.g; };
const hearts = (N, oy = 0) => prop(N, (p) => { [[6.5, 6], [20.6, 2.4]].forEach(([x, y]) => { y += oy; p.ell(x - 0.75, y, 0.95, 0.95, 'R'); p.ell(x + 0.75, y, 0.95, 0.95, 'R'); p.poly([[x - 1.7, y + 0.2], [x + 1.7, y + 0.2], [x, y + 2.1]], 'R'); }); });
const shield = (N, big = false, ox = 0) => prop(N, (p0, d) => {
  const p = { ...p0, poly: (pts, c) => p0.poly(pts.map(([x, y]) => [x + ox, y]), c), line: (pts, c) => p0.line(pts.map(([x, y]) => [x + ox, y]), c) };
  if (big) {
    p.poly([[14, 14], [29, 14], [29, 23], [21.5, 30], [14, 23]], 'F');
    if (d >= 1) p.poly([[15.4, 15.4], [27.6, 15.4], [27.6, 22.6], [21.5, 28.2], [15.4, 22.6]], 'f'), p.poly([[16.4, 16.4], [26.6, 16.4], [26.6, 22.2], [21.5, 26.8], [16.4, 22.2]], 'F');
    p.line([[18.6, 18], [24.4, 23.8]], 'W'); p.line([[24.4, 18], [18.6, 23.8]], 'W');
  } else {
    p.poly([[23, 12], [30, 12], [30, 19], [26.5, 25], [23, 19]], 'F');
    if (d >= 1) p.line([[23.8, 12.9], [29.2, 12.9]], 'S');
    p.line([[24.2, 17], [25.8, 18.8], [29, 15.4]], 'W');
  }
});
const envelope = (N) => prop(N, (p, d) => {
  p.rect(20, 17, 30, 25, 'c'); p.line([[20, 17.4], [25, 21.4], [29.8, 17.4]], 'g');
  if (d >= 1) p.line([[20.2, 24.6], [23.6, 21.8]], 'g'), p.line([[29.8, 24.6], [26.4, 21.8]], 'g');
  p.ell(25, 22.6, 1.35, 1.35, 'R'); if (d >= 1) p.dot(25, 22.6, 'Y');
});
const coin = (N, cy, cx = 27.4) => prop(N, (p, d) => {
  p.ell(cx, cy, 3.6, 3.6, 'Y'); p.ell(cx, cy, 2.5, 2.5, 'y');
  if (d >= 1) { p.line([[cx, cy - 1.8], [cx - 1.1, cy + 1.6]], 'Y'); p.line([[cx, cy - 1.8], [cx + 1.1, cy + 1.6]], 'Y'); p.line([[cx - 1.1, cy + 0.2], [cx + 1.1, cy + 0.2]], 'Y'); }
  else { p.line([[cx, cy - 1.6], [cx, cy + 1.2]], 'Y'); }
});
const glass = (N) => prop(N, (p, d) => {
  p.line([[27.6, 17.8], [30.6, 21.8]], 't'); p.line([[28.3, 17.6], [31.2, 21.4]], 't');
  p.ell(25, 15, 4, 4, 'g'); p.ell(25, 15, 2.8, 2.8, 'a'); p.line([[23.4, 14.2], [24.2, 13.2]], 'w'); if (d >= 1) p.dot(26.4, 16.4, 'w');
});
const zzz = (N, o) => { const p = pen(N); const Z = (x, y, z) => p.line([[x, y], [x + z, y], [x, y + z], [x + z, y + z]], 'K'); Z(23, 6 - o, 2.2); Z(27, 2.5 - o, 2.8); return p.g; };
const sparkle = (N, on) => { const p = pen(N); if (on) [[30.6, 12.4], [16.6, 2.2]].forEach(([x, y]) => { p.line([[x - 1.2, y], [x + 1.2, y]], 'Y'); p.line([[x, y - 1.2], [x, y + 1.2]], 'Y'); }); return p.g; };
function micro(N) {
  const s = N / 32, w = Math.round(8 * s), h = Math.round(6 * s), g = mk(w, h);
  const tailP = [[2, 3], [0, 0.8], [0.8, 3], [0, 5.2]].map(([x, y]) => [x * s, y * s]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (inPoly(x + .5, y + .5, tailP)) g[y][x] = 'F';
    if (((x + .5 - 4.4 * s) / (2.4 * s)) ** 2 + ((y + .5 - 3 * s) / (2 * s)) ** 2 <= 1) g[y][x] = 'B';
  }
  g[Math.round(2 * s)][Math.round(5 * s)] = 'K';
  return outlined(g);
}
function school(N) { const out = mk(N, N), s = N / 32, m = micro(N); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { if (r === 3 && c === 3) continue; const ox = Math.round((c * 8 + (r % 2 ? 1 : 0)) * s), oy = Math.round((1 + r * 7) * s); m.forEach((row, yy) => row.forEach((v, xx) => { if (v && out[oy + yy] && ox + xx < N) out[oy + yy][ox + xx] = v; })); } return out; }
const checkBadge = (N) => prop(N, (p) => { p.ell(26, 26, 4.6, 4.6, 'G'); p.line([[23.8, 26], [25.4, 27.8], [28.6, 24.4]], 'W'); });

function poses(N) {
  const F = (o) => fin(N, o);
  return [
    { name: 'Idle', state: 'Waiting for campaigns', frames: [stack(F({ brow: 'up' })), stack(F({ eye: 'closed', brow: 'up' })), stack(F({ tail: 1, brow: 'up' }))], ms: [1200, 140, 400] },
    { name: 'Found a job', state: 'Survey available · excited', frames: [
      stack([...F({ eye: 'wide', brow: 'up', mouth: 'o', hand: [22, 24] }), clipboard(N), exclaim(N)]),
      stack([...F({ eye: 'wide', brow: 'up', mouth: 'o', dy: -2, sy: 1.05, hand: [27.4, 14.6] }), clipboard(N, 1, -7), exclaim(N, -1), pop(N, true)]),
      stack([...F({ eye: 'happy', brow: 'happy', mouth: 'grin', sx: 1.05, sy: 0.9, hand: [24, 21] }), clipboard(N, 0, -2)]),
    ], ms: [520, 240, 420] },
    { name: 'Policy', state: "Owner's rules · firm", frames: [
      stack([...F({ eye: 'firm', brow: 'firm', mouth: 'flat', hand: [21, 19] }), shield(N)]),
      stack([...F({ eye: 'firm', brow: 'firm', mouth: 'flat', hand: [22, 19], dx: 1, sx: 1.03, sy: 0.96 }), shield(N, false, 1), impact(N)]),
    ], ms: [650, 320] },
    { name: 'Abstain', state: 'Policy says no', frames: [stack([...F({ dx: -3, eye: 'peek', brow: 'worried', hand: null }), shield(N, true)])] },
    { name: 'Sealed answer', state: 'Encrypted response', frames: [stack([...F({ hand: [19, 21], brow: 'up' }), envelope(N)]), stack([...F({ hand: [19, 21], tail: 1, dy: -1, brow: 'up' }), envelope(N)])], ms: [260, 260] },
    { name: 'Swim to school', state: 'Joining the cohort', frames: [0, 1, 2, 1].map((t, i) => stack(F({ tail: t, dx: i % 2, brow: 'up' }))), ms: [160, 160, 160, 160] },
    { name: 'School formed', state: '≥ 15 valid answers (after CRE)', frames: [stack([school(N), checkBadge(N)])] },
    { name: 'Paid', state: '+0.01 SOL · delighted', frames: [
      stack([...F({ eye: 'wide', brow: 'up', mouth: 'o', hand: null }), coin(N, 0)]),
      stack([...F({ eye: 'wide', brow: 'up', mouth: 'o', hand: null, sx: 1.05, sy: 0.9 }), coin(N, 4)]),
      stack([...F({ eye: 'happy', brow: 'happy', mouth: 'grin', hand: null, dy: -2, sy: 1.05 }), coin(N, 4.4), sparkle(N, true), hearts(N, 0)]),
      stack([...F({ eye: 'happy', brow: 'happy', mouth: 'grin', hand: null }), coin(N, 6.4), sparkle(N, true), hearts(N, -1.5)]),
    ], ms: [200, 200, 300, 800] },
    { name: 'Sleeping', state: 'No campaigns', frames: [0, 1, 2].map((o) => stack([...F({ eye: 'closed', mouth: 'flat' }), zzz(N, o)])), ms: [500, 500, 500] },
    { name: 'Researcher', state: 'Company / research mode', frames: [stack([...F({ hand: [21, 20], satchel: false, brow: 'up' }), glass(N)])] },
  ];
}

export { C, fin, poses, stack };
