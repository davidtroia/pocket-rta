// Renders App Store screenshots (from the live prototype, simulated signal), splash screens and the Play feature graphic.
// Requires a static server on the project root:  python3 -m http.server 8765
const { chromium } = require('playwright'), sharp = require('sharp'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), BASE = process.env.BASE || 'http://127.0.0.1:8765';
const out = p => path.join(ROOT, p);
async function optimise(file, flatten = true) {
  let img = sharp(file); if (flatten) img = img.flatten({ background: '#05070A' });
  const buf = await img.png({ compressionLevel: 9, adaptiveFiltering: true}).toBuffer(); fs.writeFileSync(file, buf);
}
const SHOTS = [
  { id: '1-rta', screen: 'rta', q: 'seed=11&prewarm=14', k: 'Real-time analyzer', h: 'See every band<br><span class="grad">in real time</span>', s: '31-band 1/3-octave RTA with peak hold, A, C or Z weighting and up to 1/12-octave resolution.' },
  { id: '2-spl', screen: 'spl', q: 'seed=5&prewarm=70', k: 'SPL meter', h: 'Know your level,<br><span class="grad">second by second</span>', s: 'dB SPL with A, C or Z weighting, Fast or Slow, Leq, Max, Min and a two-minute history.' },
  { id: '3-waterfall', screen: 'spectro', q: 'seed=21&genType=sweep&sweepDur=5&genLevel=-24&play=1&specRange=60', wait: 10800, k: 'Waterfall spectrogram', h: 'See sound<br><span class="grad">over time</span>', s: 'A scrolling waterfall shows sweeps, ringing tones and decays as they happen.' },
  { id: '4-generator', screen: 'gen', q: 'seed=4&genType=sine&genFreq=1000&play=1', wait: 2500, k: 'Signal generator', h: 'Test signals,<br><span class="grad">built in</span>', s: 'Pink and white noise, sine and log sweep, set to the exact dBFS level you need.' },
  { id: '5-calibration', screen: 'settings', q: 'seed=2', k: 'Calibration', h: 'Calibrate to<br><span class="grad">your reference</span>', s: 'Match a 94, 104 or 114 dB SPL calibrator in three seconds, or set the offset by hand.' },
];
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  // ---- raw UI captures: 430x932 @3x = 1290x2796 ----
  const ui = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3 });
  for (const s of SHOTS) {
    const p = await ui.newPage(); p.on('pageerror', e => errors.push(s.id + ': ' + e.message)); p.on('console', m => m.type() === 'error' && errors.push(s.id + ': ' + m.text()));
    await p.goto(`${BASE}/index.html?fresh=1&frame=0&status=1&shot=1&screen=${s.screen}&${s.q}`);
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(s.wait || 1200);
    const f = out(`assets/screenshots/raw/${s.id}.png`); await p.screenshot({ path: f }); await optimise(f); console.log(f); await p.close();
  }
  await ui.close();
  // ---- captioned App Store screenshots 1290x2796 ----
  const mk = await browser.newContext({ viewport: { width: 1290, height: 2796 }, deviceScaleFactor: 1 });
  for (const s of SHOTS) {
    const p = await mk.newPage(); p.on('pageerror', e => errors.push('cap ' + s.id + ': ' + e.message));
    const q = new URLSearchParams({ img: `/assets/screenshots/raw/${s.id}.png`, k: s.k, h: s.h, s: s.s });
    await p.goto(`${BASE}/tools/templates/screenshot.html?${q}`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
    const f = out(`assets/screenshots/appstore/appstore-${s.id}-1290x2796.png`); await p.screenshot({ path: f }); await optimise(f); console.log(f); await p.close();
  }
  await mk.close();
  // ---- splash screens ----
  for (const [w, h] of [[1290, 2796], [1242, 2688]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage();
    await p.goto(`${BASE}/tools/templates/splash.html?w=${w}&h=${h}`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
    const f = out(`assets/splash/splash-${w}x${h}.png`); await p.screenshot({ path: f }); await optimise(f); console.log(f); await c.close();
  }
  // ---- Google Play feature graphic 1024x500 ----
  { const c = await browser.newContext({ viewport: { width: 1024, height: 500 } }); const p = await c.newPage();
    await p.goto(`${BASE}/tools/templates/feature.html?img=/assets/screenshots/raw/1-rta.png`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
    const f = out('assets/feature/play-feature-graphic-1024x500.png'); await p.screenshot({ path: f }); await optimise(f); console.log(f); await c.close(); }
  await browser.close();
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
})();
