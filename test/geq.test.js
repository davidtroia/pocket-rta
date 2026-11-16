// GEQ Assist: the ring-out helper, checked end to end with generated audio on Chromium's fake microphone.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { writeWav, sine, whiteNoise, SR } = require('./wav');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prta-geq-'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const mix = (...a) => { const n = Math.max(...a.map(x => x.length)), o = new Float32Array(n); for (const x of a) for (let i = 0; i < n; i++) o[i] += x[i]; return o; };

// Plays `samples` on loop as the microphone, opens the GEQ view and returns the suggestions after `ms`.
async function run(samples, geqSet, ms = 3500) {
  const wav = path.join(tmp, 'in.wav'); writeWav(wav, samples);
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'] });
  try {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/index.html?frame=0&fresh=1&res=0&geqSet=${geqSet}`);
    await p.evaluate(() => PocketRTA.enableMic()); await p.waitForFunction(() => PocketRTA.A.src === 'mic', null, { timeout: 10000 });
    await p.waitForTimeout(ms);
    const list = await p.evaluate(() => PocketRTA.G.list.map(s => ({ band: s.band, cut: s.cut, prom: s.prom })));
    const text = await p.textContent('#geqBody'), shown = await p.evaluate(() => !document.getElementById('geqPanel').hidden);
    return { list, text, shown, errs };
  } finally { await b.close(); }
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const bed = whiteNoise(-48, 6);

  console.log('== finds a ringing tone and names the right fader ==');
  let r = await run(mix(bed, sine(1000, -30, 6)), 28);
  ok('panel is visible in GEQ view', r.shown);
  ok('1 kHz tone: one suggestion', r.list.length === 1, JSON.stringify(r.list));
  ok('1 kHz tone: fader is 1 kHz', r.list[0] && r.list[0].band === 1000, JSON.stringify(r.list));
  ok('1 kHz tone: cut is between 2 and 6 dB', r.list[0] && r.list[0].cut >= 2 && r.list[0].cut <= 6, JSON.stringify(r.list));
  ok('panel text names the fader', /1 kHz/.test(r.text) && /pull the fader down/.test(r.text), r.text);
  ok('no page errors', r.errs.length === 0, r.errs.join('|'));

  r = await run(mix(bed, sine(3900, -30, 6)), 28);
  ok('3.9 kHz tone maps to the 4 kHz fader', r.list.length === 1 && r.list[0].band === 4000, JSON.stringify(r.list));

  console.log('\n== two ringing tones, strongest first ==');
  r = await run(mix(bed, sine(1000, -30, 6), sine(250, -36, 6)), 28);
  ok('two suggestions', r.list.length === 2, JSON.stringify(r.list));
  ok('loudest is listed first', r.list.length === 2 && r.list[0].band === 1000 && r.list[1].band === 250, JSON.stringify(r.list));

  console.log('\n== no false alarms on broadband noise ==');
  r = await run(whiteNoise(-30, 6), 28, 5000);
  ok('white noise: nothing flagged', r.list.length === 0, JSON.stringify(r.list));
  ok('white noise: panel says it is listening', /Listening/.test(r.text), r.text);

  console.log('\n== band sets: only bands the console actually has ==');
  r = await run(mix(bed, sine(63, -30, 6)), 28);
  ok('63 Hz tone maps to the 63 Hz fader', r.list.length === 1 && r.list[0].band === 63, JSON.stringify(r.list));
  r = await run(mix(bed, sine(19000, -30, 6)), 28);
  ok('19 kHz tone is above a 28-band GEQ (tops out at 16 kHz): ignored', r.list.length === 0, JSON.stringify(r.list));
  r = await run(mix(bed, sine(19000, -30, 6)), 31);
  ok('19 kHz tone is flagged on a 31-band GEQ as 20 kHz', r.list.length === 1 && r.list[0].band === 20000, JSON.stringify(r.list));

  console.log('\n== a short blip is not ringing ==');
  const blip = new Float32Array(6 * SR); blip.set(sine(1000, -30, 0.3), 2 * SR);
  r = await run(mix(bed, blip), 28, 5500);
  ok('0.3 s tone burst: not flagged', r.list.length === 0, JSON.stringify(r.list));

  await server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
