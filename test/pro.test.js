// Pro unlock gating. Uses a stub for the native purchase bridge (window.PocketRTANative).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r);
});
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + extra}`); };

// stub: purchase state lives in localStorage so it survives reloads, like the store would
const STUB = (buyResult, restoreResult) => `
  window.PocketRTANative = {
    price: '$1.99',
    isPro: async () => localStorage.getItem('stubPro') === '1',
    buyPro: async () => { ${buyResult} },
    restorePro: async () => { ${restoreResult} },
  };`;
const BUY_OK = `localStorage.setItem('stubPro','1'); return true;`;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/index.html?frame=0`;
  const b = await chromium.launch();
  const open = async (init, url = base, pre) => {
    const c = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await c.newPage();
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    if (pre) await p.addInitScript(pre);
    if (init) await p.addInitScript(init);
    await p.goto(url); await p.waitForTimeout(300); return p;
  };
  const screen = p => p.evaluate(() => document.querySelector('.screen.active').dataset.screen);
  const sheet = p => p.evaluate(() => !document.getElementById('proSheet').hidden);
  const res = p => p.evaluate(() => PocketRTA.S.res);

  // 1. plain browser build: nothing locked
  let p = await open(null);
  await p.click('[data-tab=gen]'); ok('browser build: generator opens', await screen(p) === 'gen');
  await p.click('[data-tab=spectro]'); ok('browser build: waterfall opens', await screen(p) === 'spectro');
  await p.click('[data-tab=rta]'); await p.click('[data-key=res] [data-v="12"]'); ok('browser build: 1/12 octave selectable', await res(p) === 12);
  ok('browser build: no page errors', p.errs.length === 0, p.errs.join('|'));

  // 2. gated, not purchased, no native bridge (web preview of the paywall)
  p = await open(null, base + '&gate=1');
  await p.click('[data-tab=gen]'); ok('locked: generator tab stays on RTA', await screen(p) === 'rta'); ok('locked: upgrade sheet shows', await sheet(p));
  await p.click('#proSheetBuy'); ok('locked, no store: Unlock does not unlock', !(await p.evaluate(() => PocketRTA.isPro())));
  await p.click('#proSheetClose'); ok('sheet closes', !(await sheet(p)));
  await p.click('[data-tab=spectro]'); ok('locked: waterfall tab blocked', await screen(p) === 'rta'); await p.keyboard.press('Escape');
  await p.click('[data-key=res] [data-v="6"]'); ok('locked: 1/6 octave blocked', await res(p) === 3 && await sheet(p)); await p.keyboard.press('Escape');
  await p.click('[data-key=res] [data-v="0"]'); ok('locked: GEQ Assist blocked', await res(p) === 3 && await sheet(p)); await p.keyboard.press('Escape');
  await p.click('[data-key=res] [data-v="1"]'); ok('locked: free resolution 1/1 still works', await res(p) === 1);
  await p.keyboard.press('4'); ok('locked: keyboard shortcut cannot bypass', await screen(p) === 'rta');
  ok('locked: no page errors', p.errs.length === 0, p.errs.join('|'));

  // 3. native bridge, purchase succeeds, survives reload
  p = await open(STUB(BUY_OK, 'return false;'));
  ok('native: starts locked', !(await p.evaluate(() => PocketRTA.isPro())));
  ok('native: PRO badge on locked tabs', await p.evaluate(() => document.querySelectorAll('.tabbar button.pro-lock').length) === 2);
  await p.click('[data-tab=gen]'); await p.click('#proSheetBuy'); await p.waitForTimeout(200);
  ok('purchase: Pro unlocked', await p.evaluate(() => PocketRTA.isPro()));
  ok('purchase: lands on the screen the user asked for', await screen(p) === 'gen');
  ok('purchase: sheet closed', !(await sheet(p)));
  await p.click('[data-tab=rta]'); await p.click('[data-key=res] [data-v="12"]'); ok('purchase: 1/12 octave works', await res(p) === 12);
  await p.click('[data-key=res] [data-v="0"]'); await p.waitForTimeout(300); ok('purchase: GEQ Assist works', await res(p) === 0 && !(await p.evaluate(() => document.getElementById('geqPanel').hidden)));
  await p.reload(); await p.waitForTimeout(400);
  ok('purchase persists after reload', await p.evaluate(() => PocketRTA.isPro()));
  await p.click('[data-tab=spectro]'); ok('after reload: waterfall opens', await screen(p) === 'spectro');
  // refund: store says not purchased, cached flag must not keep Pro
  await p.evaluate(() => localStorage.setItem('stubPro', '0')); await p.reload(); await p.waitForTimeout(400);
  ok('refund: Pro is revoked on next launch', !(await p.evaluate(() => PocketRTA.isPro())));
  ok('native: no page errors', p.errs.length === 0, p.errs.join('|'));

  // 4. restore purchase
  p = await open(STUB(`return false;`, BUY_OK));
  await p.click('[data-tab=settings]'); await p.click('#proRestoreBtn'); await p.waitForTimeout(200);
  ok('restore: Pro unlocked from Settings', await p.evaluate(() => PocketRTA.isPro()));
  ok('restore: status row says Pro', (await p.textContent('#proStatus')) === 'Pro unlocked');
  p = await open(STUB(`return false;`, `return false;`));
  await p.click('[data-tab=settings]'); await p.click('#proRestoreBtn'); await p.waitForTimeout(200);
  ok('restore with no purchase: stays locked, says so', !(await p.evaluate(() => PocketRTA.isPro())) && /No previous purchase/.test(await p.textContent('#toast')));

  // 5. cancelled purchase and store error leave the app locked and working
  p = await open(STUB(`return false;`, 'return false;'));
  await p.click('[data-tab=gen]'); await p.click('#proSheetBuy'); await p.waitForTimeout(200);
  ok('cancelled purchase: stays locked, sheet stays open', !(await p.evaluate(() => PocketRTA.isPro())) && await sheet(p));
  p = await open(STUB(`throw new Error('store down');`, 'return false;'));
  await p.click('[data-tab=gen]'); await p.click('#proSheetBuy'); await p.waitForTimeout(200);
  ok('store error: stays locked, no crash', !(await p.evaluate(() => PocketRTA.isPro())) && p.errs.length === 0, p.errs.join('|'));

  // 6. a saved Pro-only setting does not survive while locked; URL cannot grant Pro
  p = await open(STUB(`return false;`, 'return false;'), base, `localStorage.setItem('pocketrta.v1', JSON.stringify({res:0,pro:true}));`);
  ok('locked: saved GEQ view is reset to 1/3', await res(p) === 3);
  ok('locked: cached pro flag alone does not unlock when the store says no', !(await p.evaluate(() => PocketRTA.isPro())));
  p = await open(STUB(`return false;`, 'return false;'), base + '&pro=1&screen=gen');
  ok('URL parameters cannot grant Pro or open Pro screens', !(await p.evaluate(() => PocketRTA.isPro())) && await screen(p) === 'rta');

  await b.close(); server.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
