// Headless verification: every screen renders, every control works, no JS errors; writes preview PNGs.
const { chromium } = require('playwright'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), BASE = process.env.BASE || 'http://127.0.0.1:8765', PV = n => path.join(ROOT, 'previews', n);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [], log = s => console.log('  ✓ ' + s);
  const watch = (p, tag) => { p.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${tag} ${m.type()}: ${m.text()}`); }); };
  // ---- phone viewport, simulated signal ----
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, permissions: ['microphone'] });
  const p = await c.newPage(); watch(p, 'phone');
  await p.goto(`${BASE}/index.html?fresh=1&frame=0&status=1&seed=11&prewarm=14`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1200);
  const fps = await p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  log(`RTA render loop ${fps.toFixed(0)} fps (headless)`);
  await p.screenshot({ path: PV('01-rta.png') }); log('RTA');
  for (const [k, vals] of [['res', ['1', '6', '12', '3']], ['weight', ['A', 'C', 'Z']], ['avg', ['slow', 'inf', 'fast']]]) for (const v of vals) { await p.click(`[data-screen=rta] [data-key=${k}] [data-v="${v}"]`); await p.waitForTimeout(120); }
  await p.click('[data-screen=rta] [data-key=res] [data-v="12"]'); await p.waitForTimeout(600); await p.screenshot({ path: PV('02-rta-1-12-octave.png') });
  await p.click('[data-screen=rta] [data-key=res] [data-v="3"]');
  await p.click('#freezeBtn'); const frozen = await p.evaluate(() => PocketRTA.R.frozen); await p.click('#freezeBtn'); await p.click('#peakResetBtn'); await p.click('#lineBtn'); await p.click('#lineBtn');
  log(`RTA controls (resolution, weighting, averaging, freeze=${frozen}, reset peaks, curve)`);
  await p.click('[data-tab=spl]'); await p.waitForTimeout(900); await p.screenshot({ path: PV('03-spl.png') });
  for (const v of ['C', 'Z', 'A']) await p.click(`[data-key=splW] [data-v="${v}"]`); await p.click('[data-key=splT] [data-v="slow"]'); await p.click('[data-key=splT] [data-v="fast"]'); await p.click('#splReset');
  log('SPL (weightings, time weightings, reset)');
  await p.click('[data-tab=spectro]'); await p.waitForTimeout(900); await p.screenshot({ path: PV('04-waterfall.png') });
  for (const v of ['30', '60', '10']) await p.click(`[data-key=specSpan] [data-v="${v}"]`); await p.click('#specPause'); await p.click('#specPause');
  log('Waterfall (span, pause)');
  await p.click('[data-tab=gen]');
  for (const t of ['pink', 'white', 'sine', 'sweep']) { await p.click(`[data-key=genType] [data-v="${t}"]`); await p.click('#genPlay'); await p.waitForTimeout(700);
    const st = await p.evaluate(() => ({ playing: PocketRTA.A.genPlaying, state: PocketRTA.A.ctx && PocketRTA.A.ctx.state }));
    if (t === 'sine') { await p.click('[data-preset="1000"]'); await p.click('[data-step="1"]'); await p.click('[data-step="-1"]'); await p.waitForTimeout(500); await p.screenshot({ path: PV('05-generator-sine.png') }); }
    if (t === 'sweep') { await p.waitForTimeout(1200); await p.screenshot({ path: PV('06-generator-sweep.png') }); }
    await p.click('#genPlay'); log(`Generator ${t}: played (${st.state}, playing=${st.playing}) and stopped`); }
  await p.click('[data-key=genType] [data-v="pink"]'); await p.waitForTimeout(300); await p.screenshot({ path: PV('07-generator-pink.png') });
  await p.click('[data-tab=settings]'); await p.waitForTimeout(400); await p.screenshot({ path: PV('08-settings.png') });
  await p.evaluate(() => document.querySelector('.set-scroll').scrollTo(0, 99999)); await p.waitForTimeout(300); await p.screenshot({ path: PV('09-about.png') });
  log('Settings + About');
  // ---- microphone path (Chromium fake capture device) + calibration ----
  await p.evaluate(() => document.querySelector('.set-scroll').scrollTo(0, 0));
  await p.click('#micToggle'); await p.waitForTimeout(1500);
  const src = await p.evaluate(() => PocketRTA.A.src);
  await p.click('#calBtn'); await p.waitForTimeout(3600);
  const cal = await p.evaluate(() => ({ off: PocketRTA.S.calOffset, date: PocketRTA.S.calDate }));
  await p.screenshot({ path: PV('10-calibrated-mic.png') });
  await p.click('#calResetBtn'); await p.click('[data-tab=rta]'); await p.waitForTimeout(900); await p.screenshot({ path: PV('11-rta-live-mic-input.png') });
  log(`Mic source=${src}; calibration set offset ${cal.off} dB (${cal.date ? 'saved' : 'not saved'})`);
  await p.click('#srcChip'); await p.waitForTimeout(300);
  await c.close();
  // ---- desktop, framed ----
  const d = await b.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 }); const q = await d.newPage(); watch(q, 'desktop');
  await q.goto(`${BASE}/index.html?fresh=1&seed=11&prewarm=14`); await q.evaluate(() => document.fonts.ready); await q.waitForTimeout(1200); await q.screenshot({ path: PV('00-desktop-framed.png') }); log('Desktop framed layout');
  await d.close(); await b.close();
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); } else console.log('No JS errors or warnings.');
})();
