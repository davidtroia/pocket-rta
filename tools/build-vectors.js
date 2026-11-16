// Builds all vector masters (icon, adaptive icon layers, wordmarks, Balance Digital lockups).
// Text is converted to outlines with opentype.js so the SVGs render identically everywhere.
const fs = require('fs'), path = require('path');
const opentype = require('opentype.js');
const ROOT = path.resolve(__dirname, '..');
const FONTS = process.env.FONT_DIR || '/tmp/pw/node_modules/@fontsource/montserrat/files';
const font = w => { const b = fs.readFileSync(path.join(FONTS, `montserrat-latin-${w}-normal.woff`)); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const M400 = font(400), M500 = font(500), M600 = font(600), M700 = font(700);

// Lay out text glyph by glyph with tracking (em) + kerning; returns {d, width}
function textPath(f, str, size, x, y, tracking = 0, anchor = 'start') {
  const scale = size / f.unitsPerEm;
  const glyphs = f.stringToGlyphs(str);
  let w = 0;
  const adv = glyphs.map((g, i) => {
    let a = g.advanceWidth * scale;
    if (i < glyphs.length - 1) a += f.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
    return a;
  });
  w = adv.reduce((s, a) => s + a, 0);
  let cx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  let d = '';
  glyphs.forEach((g, i) => { d += g.getPath(cx, y, size).toPathData(2); cx += adv[i]; });
  return { d, width: w };
}
const write = (rel, s) => { const p = path.join(ROOT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s.trim() + '\n'); console.log('wrote', rel); };

// ---------- Brand palette (from Balance Digital logos) ----------
const C = { teal: '#1A8FC0', tealHi: '#2BB3E8', steel: '#6F86B8', lav: '#A98BD0', lavHi: '#C3AEEA', ink: '#05080D', ink2: '#0B1220', white: '#F2F5F8' };

// ---------- Pocket RTA mark: spectrum bars inside a ring ----------
// Drawn in a 1024 box centred on 512,512.
const BARS = [162, 246, 324, 272, 356, 283, 200]; // heights (RTA-like spectrum, rising from a shared baseline)
function markBody(id, { ring = true, caps = true, mono = null } = {}) {
  const bw = 50, gap = 18, n = BARS.length, total = n * bw + (n - 1) * gap;
  const x0 = 512 - total / 2, base = 680;
  let bars = '';
  BARS.forEach((h, i) => {
    const x = x0 + i * (bw + gap);
    bars += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="10" fill="${mono || `url(#${id}-bar)`}"/>`;
    if (caps) bars += `<rect x="${x}" y="${base - h - 34}" width="${bw}" height="12" rx="6" fill="${mono || (i === 4 ? '#FFB020' : '#E8EEF6')}"/>`;
  });
  const defs = mono ? '' : `
    <linearGradient id="${id}-ring" x1="200" y1="200" x2="824" y2="824" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.tealHi}"/><stop offset=".55" stop-color="${C.steel}"/><stop offset="1" stop-color="${C.lav}"/></linearGradient>
    <linearGradient id="${id}-bar" x1="0" y1="${base}" x2="0" y2="${base - 340}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.teal}"/><stop offset=".6" stop-color="${C.steel}"/><stop offset="1" stop-color="${C.lavHi}"/></linearGradient>`;
  const ringEl = ring ? `<circle cx="512" cy="512" r="318" fill="none" stroke="${mono || `url(#${id}-ring)`}" stroke-width="46"/>` : '';
  return { defs, body: ringEl + bars };
}
function iconSVG({ rounded = false } = {}) {
  const m = markBody('m');
  const clip = rounded ? `<clipPath id="sq"><rect width="1024" height="1024" rx="228"/></clipPath>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${m.defs}
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#101A2B"/><stop offset="1" stop-color="${C.ink}"/></linearGradient>
    <radialGradient id="glow" cx="512" cy="540" r="470" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.teal}" stop-opacity=".30"/><stop offset=".6" stop-color="${C.steel}" stop-opacity=".08"/><stop offset="1" stop-color="${C.steel}" stop-opacity="0"/></radialGradient>
    ${clip}
  </defs>
  <g${rounded ? ' clip-path="url(#sq)"' : ''}>
    <rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>
    ${m.body}
  </g>
</svg>`;
}
write('assets/icon/pocket-rta-icon.svg', iconSVG());
write('assets/icon/pocket-rta-icon-rounded.svg', iconSVG({ rounded: true }));

// Mark only (transparent) for UI / wordmark
const markOnly = (id = 'k') => { const m = markBody(id); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="160 160 704 704"><defs>${m.defs}</defs>${m.body}</svg>`; };
write('assets/icon/pocket-rta-mark.svg', markOnly());

// Android adaptive icon: 108dp canvas; safe zone is centre 66dp => scale mark into 61% of canvas
{
  const m = markBody('a');
  const s = 0.60, t = 512 * (1 - s);
  write('assets/icon/android/adaptive-foreground.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>${m.defs}</defs><g transform="translate(${t} ${t}) scale(${s})">${m.body}</g></svg>`);
  write('assets/icon/android/adaptive-background.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#101A2B"/><stop offset="1" stop-color="${C.ink}"/></linearGradient>
    <radialGradient id="glow" cx="512" cy="540" r="470" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.teal}" stop-opacity=".30"/><stop offset="1" stop-color="${C.steel}" stop-opacity="0"/></radialGradient></defs>
    <rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/></svg>`);
  const mm = markBody('mo', { mono: '#FFFFFF' });
  write('assets/icon/android/adaptive-monochrome.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(${t} ${t}) scale(${s})">${mm.body}</g></svg>`);
}

// ---------- Pocket RTA wordmark ----------
function wordmark(variant) {
  const dark = variant === 'dark'; // dark = for dark backgrounds (white text)
  const m = markBody('w' + variant);
  const size = 210, baseY = 330, tx = 470;
  const p1 = textPath(M600, 'Pocket', size, tx, baseY, -0.01);
  const p2 = textPath(M700, 'RTA', size, tx + p1.width + size * 0.26, baseY, 0.02);
  const W = Math.ceil(tx + p1.width + size * 0.26 + p2.width + 40);
  const rtaGrad = dark ? [C.tealHi, C.lavHi] : ['#137AA6', '#7A5FB8'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 460" width="${W}" height="460">
  <defs>${m.defs}<linearGradient id="rta${variant}" x1="${tx + p1.width}" y1="0" x2="${W}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rtaGrad[0]}"/><stop offset="1" stop-color="${rtaGrad[1]}"/></linearGradient></defs>
  <g transform="translate(20 20) scale(${420 / 704}) translate(-160 -160)">${m.body}</g>
  <path d="${p1.d}" fill="${dark ? C.white : C.ink2}"/>
  <path d="${p2.d}" fill="url(#rta${variant})"/>
</svg>`;
}
write('assets/logo/pocket-rta-wordmark-dark.svg', wordmark('dark'));
write('assets/logo/pocket-rta-wordmark-light.svg', wordmark('light'));

// ---------- Balance Digital "bo" lockup (rebuilt from the official artwork) ----------
function boMark(id, bColor) {
  // b: stem + bowl ring ; o: ring. Interlocked: b passes over o at the top crossing, o over b at the bottom.
  const sw = 36, rb = 84, ro = 88, bcx = 456, ocx = 582, cy = 411;
  const ring = (cx, r, stroke) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
  const defs = `<linearGradient id="${id}-o" x1="${ocx - ro - 20}" y1="${cy + 40}" x2="${ocx + ro + 20}" y2="${cy - 40}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B5A82"/><stop offset=".35" stop-color="#137DAE"/><stop offset="1" stop-color="#1A9BD0"/></linearGradient>
    <clipPath id="${id}-low"><rect x="${bcx}" y="${cy + 20}" width="140" height="140"/></clipPath>`;
  const o = ring(ocx, ro, `url(#${id}-o)`);
  const b = `<rect x="${bcx - rb - sw / 2}" y="280" width="${sw}" height="${cy - 280}" fill="${bColor}"/>` + ring(bcx, rb, bColor);
  return { defs, body: o + b + `<g clip-path="url(#${id}-low)">${o}</g>` };
}
function boLockup(variant) {
  const dark = variant === 'dark';
  const fg = dark ? '#FFFFFF' : '#0B0F14';
  const m = boMark('bo' + variant, fg);
  const t1 = textPath(M400, 'BALANCE', 92, 512, 641, 0.17, 'middle');
  const t2 = textPath(M500, 'DIGITAL', 40, 512, 712, 0.28, 'middle');
  const half = t2.width / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="200 250 624 490" width="1248" height="980">
  <defs>${m.defs}</defs>${m.body}
  <path d="${t1.d}" fill="${fg}"/><path d="${t2.d}" fill="${fg}"/>
  <rect x="${t1.width / -2 + 512}" y="696" width="${512 - half - 30 - (512 - t1.width / 2)}" height="2.5" fill="${fg}"/>
  <rect x="${512 + half + 26}" y="696" width="${512 - half - 30 - (512 - t1.width / 2)}" height="2.5" fill="${fg}"/>
</svg>`;
}
write('assets/brand/balance-digital-logo-dark.svg', boLockup('dark'));
write('assets/brand/balance-digital-logo-light.svg', boLockup('light'));
{ const m = boMark('bm', '#FFFFFF'); write('assets/brand/balance-digital-mark-dark.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="330 260 400 300"><defs>${m.defs}</defs>${m.body}</svg>`); }

// ---------- Balance Digital waveform lockup ----------
{
  const t1 = textPath(M600, 'Balance', 168, 512, 430, -0.005, 'middle');
  const t2 = textPath(M500, 'DIGITAL', 50, 512, 508, 0.36, 'middle');
  const wf = [10, 22, 40, 62, 84, 62, 40, 22, 10]; // heights (half) of waveform bars
  let bars = ''; const bw = 7, g = 11; const x0 = 512 - (wf.length * bw + (wf.length - 1) * g) / 2;
  wf.forEach((h, i) => bars += `<rect x="${(x0 + i * (bw + g)).toFixed(1)}" y="${233 - h / 2 * 1.05}" width="${bw}" height="${h * 1.05}" rx="3.5" fill="url(#wl)"/>`);
  write('assets/brand/balance-digital-waveform-logo.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="130 130 764 410" width="1528" height="820">
  <defs>
    <linearGradient id="wt" x1="${512 - t1.width / 2}" y1="0" x2="${512 + t1.width / 2}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6F86B8"/><stop offset=".7" stop-color="#7E8CC4"/><stop offset="1" stop-color="#A98BD0"/></linearGradient>
    <linearGradient id="wl" x1="0" y1="160" x2="0" y2="306" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#C3AEEA"/><stop offset="1" stop-color="#9C86CF"/></linearGradient>
  </defs>
  <circle cx="512" cy="233" r="72" fill="none" stroke="#7B8FC0" stroke-width="8"/>${bars}
  <path d="${t1.d}" fill="url(#wt)"/><path d="${t2.d}" fill="#B49AD8"/>
</svg>`);
}
