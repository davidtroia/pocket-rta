// End-to-end DSP checks. Real Chromium, real Web Audio, real getUserMedia path: Chromium's fake capture
// device plays a generated WAV as the "microphone", and we read the meter state back out of the app.
// Convention under test: default calibration offset 120 dB, so 0 dBFS RMS reads 120 dB and 94 dB SPL = -26 dBFS.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { writeWav, sine, silence, whiteNoise, concat } = require('./wav');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prta-'));
let pass = 0, fail = 0;
const chk = (name, got, want, tol) => { const ok = Number.isFinite(got) && Math.abs(got - want) <= tol; ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${Number(got).toFixed(2)} (expected ${want.toFixed(2)} ±${tol})`); };

// Play `samples` as the microphone. loop=false plays once then silence.
async function withMic(samples, loop, fn) {
  const wav = path.join(tmp, 'in.wav'); writeWav(wav, samples);
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}${loop ? '' : '%noloop'}`, '--autoplay-policy=no-user-gesture-required'] });
  try {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/index.html?fresh=1&frame=0&avg=inf`);
    await p.evaluate(() => PocketRTA.enableMic());
    await p.waitForFunction(() => PocketRTA.A.src === 'mic', null, { timeout: 10000 });
    await fn(p);
    if (errs.length) { fail++; console.log('FAIL  page errors: ' + errs.join(' | ')); }
  } finally { await b.close(); }
}
const sleep = (p, ms) => p.waitForTimeout(ms);
const spl = (p, w, t) => p.evaluate(([w, t]) => { const L = PocketRTA.L; return 10 * Math.log10(L.tw[w + t]); }, [w, t]);
const leq = (p, w) => p.evaluate(w => { const L = PocketRTA.L; return 10 * Math.log10(L.E[w] / L.T); }, w);
const maxDb = (p, k) => p.evaluate(k => PocketRTA.L.max[k], k);
const reset = p => p.evaluate(() => PocketRTA.resetAll());

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  console.log('== absolute level and weighting on the SPL path (tone at -26 dBFS RMS = 94 dB SPL) ==');
  // Known limitation: the SPL path weights each bin of a 2048-point FFT (23 Hz wide). For a pure tone near 63 Hz the
  // steep A curve is sampled at bin centres, which reads about +0.9 dB high (IEC 61672 Class 2 allows +/-1.5 dB there).
  // The wider tolerance on that one case documents the limit; time-domain weighting filters would remove it.
  for (const [f, a, c, aTol] of [[1000, 0, 0, 0.6], [63, -26.2, -0.8, 1.2], [4000, 1.0, -0.8, 0.6], [125, -16.1, -0.2, 0.6]]) {
    await withMic(sine(f, -26, 4), true, async p => {
      await sleep(p, 1500); await reset(p); await sleep(p, 2500);
      chk(`${f} Hz: LZ`, await spl(p, 'Z', 'fast'), 94, 0.5);
      chk(`${f} Hz: LA`, await spl(p, 'A', 'fast'), 94 + a, aTol);
      chk(`${f} Hz: LC`, await spl(p, 'C', 'fast'), 94 + c, 0.6);
    });
  }

  console.log('\n== Leq: steady tone, and energy (not dB) averaging of two levels ==');
  await withMic(sine(1000, -26, 4), true, async p => { await sleep(p, 1500); await reset(p); await sleep(p, 3000); chk('LAeq of steady 94 dB tone', await leq(p, 'A'), 94, 0.4); });
  // 1 s at 94 dB then 1 s at 74 dB, looping. Energy mean = 10log10((10^9.4 + 10^7.4)/2) = 91.04; a dB average would give 84.
  await withMic(concat(sine(1000, -26, 1), sine(1000, -46, 1)), true, async p => {
    await sleep(p, 1500); await reset(p); await sleep(p, 8000);
    chk('LAeq of alternating 94/74 dB (energy average)', await leq(p, 'A'), 91.04, 0.7);
  });

  console.log('\n== Fast time weighting on a 100 ms burst (94+ dB over a 60 dB bed) ==');
  // bed 1 kHz at -60 dBFS (60 dB), 100 ms burst at -30 dBFS (90 dB). Fast (125 ms) peak = 10log10(1e6+(1e9-1e6)(1-e^-0.8)) = 87.41
  await withMic(concat(sine(1000, -60, 2), sine(1000, -30, 0.1), sine(1000, -60, 2)), false, async p => {
    await sleep(p, 1200); await reset(p); await sleep(p, 6000);
    chk('LAFmax of 100 ms burst', await maxDb(p, 'Afast'), 87.41, 0.8);
  });

  console.log('\n== RTA: 1/3-octave band level of a tone, and of flat noise ==');
  await withMic(sine(1000, -26, 4), true, async p => {
    await sleep(p, 1500); await p.evaluate(() => PocketRTA.resetAll()); await sleep(p, 3000);
    const r = await p.evaluate(() => { const bs = PocketRTA.BANDS[3], R = PocketRTA.R; const i = bs.findIndex(b => Math.abs(b.fc - 1000) < 1); return { at: R.disp[i], lo: R.disp[i - 3], hi: R.disp[i + 3] }; });
    chk('1 kHz band reads the tone level', r.at, 94, 0.5);
    chk('band 3 steps below is >40 dB down', r.lo, 94 - 50, 12); chk('band 3 steps above is >40 dB down', r.hi, 94 - 50, 12);
  });
  // White noise at -20 dBFS RMS: PSD flat, so band level = 100 + 10log10(bandwidth / (sr/2)).
  await withMic(whiteNoise(-20, 8), true, async p => {
    await sleep(p, 1500); await reset(p); await sleep(p, 9000);
    const sr = await p.evaluate(() => PocketRTA.A.ctx.sampleRate);
    const lv = await p.evaluate(() => { const bs = PocketRTA.BANDS[3], R = PocketRTA.R; return bs.map((b, i) => ({ lo: b.lo, hi: b.hi, fc: b.fc, db: R.disp[i] })); });
    for (const [f, tol] of [[1000, 0.5], [250, 0.6], [8000, 0.5], [40, 1.4], [25, 2.0]]) {
      const b = lv.reduce((a, x) => Math.abs(Math.log(x.fc / f)) < Math.abs(Math.log(a.fc / f)) ? x : a);
      chk(`flat noise, ${f} Hz band`, b.db, 100 + 10 * Math.log10((b.hi - b.lo) / (sr / 2)), tol);
    }
  });

  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
