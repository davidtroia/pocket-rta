/* Pocket RTA 1.0 — Balance Digital LLC
   Real-time analyzer, SPL meter, spectrogram and signal generator on the Web Audio API. */
'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const Q = new URLSearchParams(location.search);
  const LN10_10 = Math.LN10 / 10;
  const dbToP = db => Math.exp(db * LN10_10);           // dB -> power ratio
  const pToDb = p => (p > 1e-30 ? 10 * Math.log10(p) : -300);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ---------------- seeded PRNG (simulation only) ----------------
  let seed = Q.has('seed') ? (Number(Q.get('seed')) >>> 0) : (Math.random() * 4294967296) >>> 0;
  function rand() { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  function gauss() { let u = 0; while (u === 0) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * rand()); }

  // ---------------- settings ----------------
  const DEFAULTS = { res: 3, weight: 'Z', avg: 'fast', splW: 'A', splT: 'fast', calOffset: 120, calRef: 94, calDate: null,
    rtaTop: 100, rtaRange: 60, showLine: true, specSpan: 10, specRange: 60, genType: 'pink', genFreq: 1000, genLevel: -18, sweepDur: 5, deviceId: '' };
  const KEY = 'pocketrta.v1';
  const S = Object.assign({}, DEFAULTS);
  if (!Q.has('fresh')) { try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ } }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } };

  // ---------------- frequency grid: 1/24-octave fine bands, base-2, aligned so 1/1..1/12 bands are exact groups ----------------
  const FINE_LO = -140, NF = 248;
  const fLo = new Float64Array(NF), fHi = new Float64Array(NF), fC = new Float64Array(NF);
  for (let i = 0; i < NF; i++) { fLo[i] = 1000 * 2 ** ((FINE_LO + i) / 24); fHi[i] = 1000 * 2 ** ((FINE_LO + i + 1) / 24); fC[i] = Math.sqrt(fLo[i] * fHi[i]); }
  const F_MIN = fLo[0], F_MAX = fHi[NF - 1], LOG_SPAN = Math.log2(F_MAX / F_MIN);
  const xNorm = f => Math.log2(f / F_MIN) / LOG_SPAN;

  // display bands for 1/N octave
  const NOMINAL = [16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
  function buildBands(N) {
    const per = 24 / N, out = [];
    const nMin = Math.ceil((FINE_LO + per / 2) / per), nMax = Math.floor((FINE_LO + NF - per / 2) / per);
    for (let n = nMin; n <= nMax; n++) {
      const i0 = per * n - per / 2 - FINE_LO, i1 = i0 + per; // fine index range [i0,i1)
      const fc = 1000 * 2 ** (n / N);
      let nominal = fc;
      if (N <= 3) nominal = NOMINAL.reduce((a, b) => (Math.abs(Math.log(b / fc)) < Math.abs(Math.log(a / fc)) ? b : a));
      out.push({ i0, i1, fc, nominal, lo: fLo[i0], hi: fHi[i1 - 1] });
    }
    return out;
  }
  const BANDS = { 1: buildBands(1), 3: buildBands(3), 6: buildBands(6), 12: buildBands(12) };

  function fmtHz(f, nominal) {
    if (nominal && f >= 1000) return (f / 1000).toString().replace(/\.0$/, '') + 'k';
    if (f < 100) return (Math.round(f * 10) / 10).toString();
    if (f < 1000) return Math.round(f).toString();
    if (f < 10000) return (f / 1000).toFixed(2) + 'k';
    return (f / 1000).toFixed(1) + 'k';
  }
  const fmtHzU = f => { const s = fmtHz(f); return s.endsWith('k') ? s.slice(0, -1) + ' kHz' : s + ' Hz'; };

  // ---------------- IEC 61672 frequency weightings ----------------
  function weightDb(type, f) {
    if (type === 'Z') return 0;
    const f2 = f * f, a = 20.598997 ** 2, b = 107.65265 ** 2, c = 737.86223 ** 2, d = 12194.217 ** 2;
    if (type === 'A') return 20 * Math.log10((d * f2 * f2) / ((f2 + a) * Math.sqrt((f2 + b) * (f2 + c)) * (f2 + d))) + 2.0;
    return 20 * Math.log10((d * f2) / ((f2 + a) * (f2 + d))) + 0.062;
  }
  const WFINE = {};
  for (const t of ['Z', 'A', 'C']) { WFINE[t] = new Float64Array(NF); for (let i = 0; i < NF; i++) WFINE[t][i] = dbToP(weightDb(t, fC[i])); }

  // ---------------- FFT bins -> fine band power mapping ----------------
  // AnalyserNode: X[k] = (1/N) Σ x w e^-j..., Blackman window, dB = 20log10|X[k]|.
  // Mean-square of the signal = 2 Σ|X[k]|² / mean(w²);  mean(w²) of Blackman(0.42,0.5,0.08) = 0.3046
  const WIN_K = 2 / 0.3046;
  function buildMap(fftSize, sr) {
    const nb = fftSize / 2, df = sr / fftSize, start = new Int32Array(NF), count = new Int32Array(NF), w = [];
    for (let i = 0; i < NF; i++) {
      const lo = fLo[i], hi = fHi[i];
      let k0 = Math.max(1, Math.floor(lo / df + 0.5)), k1 = Math.min(nb - 1, Math.floor(hi / df + 0.5));
      start[i] = k0; count[i] = Math.max(0, k1 - k0 + 1);
      for (let k = k0; k <= k1; k++) {
        const bl = (k - 0.5) * df, bh = (k + 0.5) * df;
        w.push(Math.max(0, Math.min(hi, bh) - Math.max(lo, bl)) / df * WIN_K);
      }
    }
    // offsets into weights
    const off = new Int32Array(NF); let o = 0; for (let i = 0; i < NF; i++) { off[i] = o; o += count[i]; }
    return { start, count, off, w: Float64Array.from(w), nb, lin: new Float64Array(nb), db: new Float32Array(nb) };
  }
  function analyserToFine(an, map, out, gain) {
    an.getFloatFrequencyData(map.db);
    const db = map.db, lin = map.lin;
    for (let k = 0; k < map.nb; k++) { const v = db[k]; lin[k] = v > -200 ? Math.exp(v * LN10_10) : 0; }
    for (let i = 0; i < NF; i++) {
      let s = 0; const st = map.start[i], o = map.off[i], c = map.count[i];
      for (let j = 0; j < c; j++) s += lin[st + j] * map.w[o + j];
      out[i] = s * gain;
    }
  }

  // ---------------- audio state ----------------
  const A = { ctx: null, src: 'sim', stream: null, micNode: null, anMain: null, anSpl: null, mapMain: null, splW: null, splBuf: null, td: null,
    genAn: null, mapGen: null, genGain: null, genEnv: null, genNode: null, genPlaying: false, genStartedAt: 0, sweepTimer: 0, sweepT0: 0, buffers: {}, deviceLabel: '', trackSettings: null };

  function ensureCtx() {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {}); return A.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { toast('Web Audio is not available in this browser.'); return null; }
    A.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = A.ctx;
    A.genAn = ctx.createAnalyser(); A.genAn.fftSize = 8192; A.genAn.smoothingTimeConstant = 0;
    A.genAn.minDecibels = -160; A.genAn.maxDecibels = 0;
    A.mapGen = buildMap(8192, ctx.sampleRate);
    A.genTd = new Float32Array(2048);
    A.genGain = ctx.createGain(); A.genGain.gain.value = 0;
    A.genGain.connect(ctx.destination); A.genGain.connect(A.genAn);
    updateInputInfo();
    return ctx;
  }

  async function enableMic() {
    const ctx = ensureCtx(); if (!ctx) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Microphone access needs HTTPS or localhost. Using the simulated signal.'); return; }
    try {
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } };
      if (S.deviceId) audio.deviceId = { exact: S.deviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      disableMic(true);
      A.stream = stream;
      A.micNode = ctx.createMediaStreamSource(stream);
      A.anMain = ctx.createAnalyser(); A.anMain.fftSize = 8192; A.anMain.smoothingTimeConstant = 0; A.anMain.minDecibels = -160; A.anMain.maxDecibels = 0;
      A.anSpl = ctx.createAnalyser(); A.anSpl.fftSize = 2048; A.anSpl.smoothingTimeConstant = 0; A.anSpl.minDecibels = -160; A.anSpl.maxDecibels = 0;
      A.micNode.connect(A.anMain); A.micNode.connect(A.anSpl);
      A.mapMain = buildMap(8192, ctx.sampleRate);
      buildSplWeights(ctx.sampleRate);
      const tr = stream.getAudioTracks()[0];
      A.deviceLabel = tr ? tr.label : '';
      A.trackSettings = tr && tr.getSettings ? tr.getSettings() : null;
      if (tr) tr.addEventListener('ended', () => { setSource('sim'); toast('Microphone disconnected. Using the simulated signal.'); });
      setSource('mic');
      resetAll();
      listDevices();
      toast('Microphone active' + (A.deviceLabel ? ': ' + A.deviceLabel : '') + '.');
    } catch (err) {
      const why = err && err.name === 'NotAllowedError' ? 'permission was denied' : err && err.name === 'NotFoundError' ? 'no input device was found' : (err && err.message) || 'it could not be opened';
      toast('Microphone unavailable: ' + why + '. Using the simulated signal.');
      setSource('sim');
    }
  }
  function disableMic(silent) {
    if (A.stream) A.stream.getTracks().forEach(t => t.stop());
    if (A.micNode) try { A.micNode.disconnect(); } catch (e) { /* already */ }
    A.stream = null; A.micNode = null; A.anMain = null; A.anSpl = null;
    if (!silent) { setSource('sim'); resetAll(); }
  }
  function buildSplWeights(sr) {
    const nb = 1024, df = sr / 2048;
    A.splW = {}; A.splBuf = new Float32Array(nb); A.td = new Float32Array(2048);
    for (const t of ['Z', 'A', 'C']) {
      const w = new Float64Array(nb);
      for (let k = 1; k < nb; k++) { const f = k * df; w[k] = f < 10 || f > 22400 ? 0 : dbToP(weightDb(t, f)) * WIN_K; }
      A.splW[t] = w;
    }
  }
  async function listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      const sel = $('#devSelect');
      sel.innerHTML = '';
      const def = document.createElement('option'); def.value = ''; def.textContent = 'Default microphone'; sel.appendChild(def);
      devs.forEach((d, i) => { if (d.deviceId === 'default' || !d.deviceId) return; const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Input ' + (i + 1); sel.appendChild(o); });
      sel.value = S.deviceId && [...sel.options].some(o => o.value === S.deviceId) ? S.deviceId : '';
    } catch (e) { /* not permitted yet */ }
  }

  // ---------------- signal generator ----------------
  function noiseBuffer(type) {
    if (A.buffers[type]) return A.buffers[type];
    const ctx = A.ctx, len = 1 << 19, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') { d[i] = w; continue; }
      // Paul Kellet's refined pink filter (−3 dB/oct within ±0.05 dB above 9 Hz)
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
    // remove DC, normalise to RMS 1, limit crest factor to 4 (12 dB) so −12 dBFS RMS never clips
    let m = 0; for (let i = 0; i < len; i++) m += d[i]; m /= len;
    let e = 0; for (let i = 0; i < len; i++) { d[i] -= m; e += d[i] * d[i]; }
    const g = 1 / Math.sqrt(e / len);
    for (let i = 0; i < len; i++) { let v = d[i] * g; if (v > 3.98) v = 3.98; else if (v < -3.98) v = -3.98; d[i] = v; }
    // crossfade loop seam
    const xf = 2048; for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[len - xf + i] * (1 - a); }
    A.buffers[type] = buf; return buf;
  }
  const genMaxLevel = () => (S.genType === 'sine' || S.genType === 'sweep' ? -3 : -12);
  const genLinear = () => { const rms = dbToP(S.genLevel / 2); return S.genType === 'sine' || S.genType === 'sweep' ? rms * Math.SQRT2 : rms; };
  function buildGenSource() {
    const ctx = A.ctx;
    if (A.genNode) { const old = A.genNode, oldEnv = A.genEnv, t = ctx.currentTime; oldEnv.gain.setTargetAtTime(0, t, 0.01); setTimeout(() => { try { old.stop(); old.disconnect(); oldEnv.disconnect(); } catch (e) { /* stopped */ } }, 120); }
    clearInterval(A.sweepTimer);
    const env = ctx.createGain(); env.gain.value = 0; env.connect(A.genGain);
    let node;
    if (S.genType === 'pink' || S.genType === 'white') {
      node = ctx.createBufferSource(); node.buffer = noiseBuffer(S.genType); node.loop = true;
    } else {
      node = ctx.createOscillator(); node.type = 'sine';
      node.frequency.value = S.genType === 'sine' ? S.genFreq : 20;
    }
    node.connect(env); node.start();
    const t = ctx.currentTime; env.gain.setTargetAtTime(1, t, 0.015);
    A.genNode = node; A.genEnv = env;
    if (S.genType === 'sweep') scheduleSweep(true);
  }
  function scheduleSweep(restart) {
    const ctx = A.ctx, D = S.sweepDur, osc = A.genNode, env = A.genEnv;
    if (restart) { A.sweepT0 = ctx.currentTime + 0.03; A.sweepNext = A.sweepT0; osc.frequency.cancelScheduledValues(0); env.gain.cancelScheduledValues(0); env.gain.setValueAtTime(0, ctx.currentTime); }
    const plan = () => {
      while (A.sweepNext < ctx.currentTime + 1.5) {
        const t0 = A.sweepNext, f = 4e-3;
        osc.frequency.setValueAtTime(20, t0);
        osc.frequency.exponentialRampToValueAtTime(20000, t0 + D);
        env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(1, t0 + f);
        env.gain.setValueAtTime(1, t0 + D - f); env.gain.linearRampToValueAtTime(0, t0 + D);
        A.sweepNext = t0 + D;
      }
    };
    plan(); A.sweepTimer = setInterval(plan, 250);
  }
  function applyGenLevel(instant) {
    if (!A.ctx) return;
    const g = A.genPlaying ? genLinear() : 0, t = A.ctx.currentTime;
    A.genGain.gain.cancelScheduledValues(t);
    if (instant) A.genGain.gain.setValueAtTime(g, t); else A.genGain.gain.setTargetAtTime(g, t, 0.02);
  }
  function genStart() {
    const ctx = ensureCtx(); if (!ctx) return;
    A.genPlaying = true; buildGenSource(); applyGenLevel(); uiGen();
  }
  function genStop() {
    A.genPlaying = false; applyGenLevel(); clearInterval(A.sweepTimer);
    const node = A.genNode, env = A.genEnv; A.genNode = null; A.genEnv = null;
    if (node) setTimeout(() => { try { node.stop(); node.disconnect(); env.disconnect(); } catch (e) { /* stopped */ } }, 150);
    uiGen();
  }

  // ---------------- simulation model (used when no microphone is active) ----------------
  // A pink-noise excitation through a typical small-venue response, measured by a phone mic.
  // Values are produced as "dBFS-equivalent" power so the calibration offset applies exactly as for a real input.
  const SIM_BASE = -120;          // model SPL -> input dBFS (matches default 120 dB offset)
  const SIM_BAND_DB = 64.5;       // per 1/24-oct band SPL of the virtual PA (≈ 88 dB SPL Z broadband)
  const SIM_GEN_DB = 108;         // generator loopback: dBFS -> SPL at the virtual mic position
  function roomDb(f) {
    const l2 = Math.log2;
    let d = 4.5 * Math.exp(-((l2(f / 63) / 0.33) ** 2)) - 4 * Math.exp(-((l2(f / 170) / 0.3) ** 2)) + 2 * Math.exp(-((l2(f / 3000) / 0.8) ** 2)) + 3 / (1 + (f / 90) ** 2);
    if (f < 40) d -= 18 * l2(40 / f);
    if (f > 9000) d -= 4.5 * l2(f / 9000);
    return d;
  }
  const SIM = { room: new Float64Array(NF), floor: new Float64Array(NF), dof: new Int32Array(NF), mult: new Float64Array(NF).fill(1), drift: 0, ring: null, nextRing: 4 };
  for (let i = 0; i < NF; i++) {
    SIM.room[i] = dbToP(roomDb(fC[i]));
    SIM.floor[i] = dbToP(SIM_BASE + 6 + 12 / (1 + fC[i] / 150));
    SIM.dof[i] = clamp(Math.round((fHi[i] - fLo[i]) * 0.17), 1, 48);
  }
  const RING_F = [630, 1000, 1600, 2500, 3150, 4000];
  const genTmp = new Float64Array(NF);
  function simStep(dt, out) {
    SIM.drift += -SIM.drift * dt / 5 + gauss() * Math.sqrt(dt) * 0.9;
    SIM.nextRing -= dt;
    if (!SIM.ring && SIM.nextRing <= 0) { const f = RING_F[(rand() * RING_F.length) | 0] * (0.97 + rand() * 0.06); SIM.ring = { i: Math.round(24 * Math.log2(f / 1000) - 0.5 - FINE_LO), t: 0, rise: 1.4, hold: 1.2, fall: 0.6 }; }
    let ringP = 0, ringI = -9;
    if (SIM.ring) {
      const r = SIM.ring; r.t += dt; const T = r.rise + r.hold + r.fall;
      const env = r.t < r.rise ? r.t / r.rise : r.t < r.rise + r.hold ? 1 : Math.max(0, 1 - (r.t - r.rise - r.hold) / r.fall);
      ringP = dbToP(SIM_BASE + SIM_BAND_DB + 15 - (1 - env) * 40) * (env > 0 ? 1 : 0); ringI = r.i;
      if (r.t >= T) { SIM.ring = null; SIM.nextRing = 6 + rand() * 6; }
    }
    const genOn = A.genPlaying && A.ctx && A.ctx.state === 'running';
    if (genOn) analyserToFine(A.genAn, A.mapGen, genTmp, dbToP(SIM_GEN_DB + SIM_BASE));
    const src = genOn ? 0 : dbToP(SIM_BASE + SIM_BAND_DB + SIM.drift);
    const a = 1 - Math.exp(-dt / 0.085);
    for (let i = 0; i < NF; i++) {
      const k = SIM.dof[i]; let x;
      if (k <= 6) { x = 0; for (let j = 0; j < k; j++) x -= Math.log(1 - rand()); x /= k; } else x = Math.max(0.05, 1 + gauss() / Math.sqrt(k));
      SIM.mult[i] += (x - SIM.mult[i]) * a;
      let p = (src * SIM.room[i] + SIM.floor[i]) * SIM.mult[i];
      if (genOn) p += genTmp[i] * SIM.room[i];
      const di = i - ringI; if (!genOn && di >= -1 && di <= 1) p += ringP * (di === 0 ? 1 : 0.18);
      out[i] = p;
    }
  }

  // ---------------- measurement state ----------------
  const RAW = new Float64Array(NF);
  const R = { avg: new Float64Array(NF), sum: new Float64Array(NF), sumT: 0, init: false, disp: new Float64Array(130), peak: new Float64Array(130).fill(-300), frozen: false,
    spec: new Float64Array(NF), rowAcc: new Float64Array(NF), rowT: 0, specPaused: false };
  const TAU = { fast: 0.125, slow: 1.0 };
  const W3 = ['Z', 'A', 'C'], T2 = ['fast', 'slow'];
  const L = { tw: {}, max: {}, min: {}, E: { Z: 0, A: 0, C: 0 }, T: 0, init: false, hist: {}, histN: 1200, histI: 0, histCount: 0, histAcc: 0, inPeak: -120, inst: { Z: 0, A: 0, C: 0 } };
  for (const w of W3) for (const t of T2) { L.hist[w + t] = new Float32Array(L.histN); }
  const CAL = { on: false, t: 0, acc: 0, dur: 3 };

  function resetRTA() { R.init = false; R.sumT = 0; R.sum.fill(0); R.peak.fill(-300); }
  function resetPeaks() { R.peak.fill(-300); if (S.avg === 'inf') { R.sum.fill(0); R.sumT = 0; } }
  function resetSPL() { L.init = false; L.T = 0; for (const w of W3) L.E[w] = 0; L.histI = 0; L.histCount = 0; L.histAcc = 0; }
  function resetAll() { resetRTA(); resetSPL(); }

  function process(dt) {
    const cal = dbToP(S.calOffset);
    let pZ, pA, pC;
    if (A.src === 'mic' && A.anMain) {
      analyserToFine(A.anMain, A.mapMain, RAW, 1);
      A.anSpl.getFloatFrequencyData(A.splBuf);
      let z = 0, a = 0, c = 0; const b = A.splBuf, wz = A.splW.Z, wa = A.splW.A, wc = A.splW.C;
      for (let k = 1; k < b.length; k++) { const v = b[k]; if (v < -200) continue; const p = Math.exp(v * LN10_10); z += p * wz[k]; a += p * wa[k]; c += p * wc[k]; }
      pZ = z; pA = a; pC = c;
      A.anSpl.getFloatTimeDomainData(A.td); let pk = 0; for (let i = 0; i < A.td.length; i++) { const v = Math.abs(A.td[i]); if (v > pk) pk = v; }
      L.inPeak = Math.max(20 * Math.log10(pk + 1e-9), L.inPeak - 30 * dt);
    } else {
      simStep(dt, RAW);
      pZ = 0; pA = 0; pC = 0;
      for (let i = 0; i < NF; i++) { const p = RAW[i]; pZ += p; pA += p * WFINE.A[i]; pC += p * WFINE.C[i]; }
      L.inPeak = Math.max(pToDb(pZ) + 11, L.inPeak - 30 * dt);
    }
    if (CAL.on) { CAL.acc += pZ * dt; CAL.t += dt; if (CAL.t >= CAL.dur) finishCal(); }

    // ---- RTA averaging (power domain, selected weighting) ----
    const wt = WFINE[S.weight];
    if (!R.frozen) {
      if (!R.init) { for (let i = 0; i < NF; i++) R.avg[i] = RAW[i] * wt[i]; R.init = true; }
      if (S.avg === 'inf') {
        R.sumT += dt; for (let i = 0; i < NF; i++) { R.sum[i] += RAW[i] * wt[i] * dt; R.avg[i] = R.sum[i] / R.sumT; }
      } else {
        const a = 1 - Math.exp(-dt / TAU[S.avg]);
        for (let i = 0; i < NF; i++) R.avg[i] += (RAW[i] * wt[i] - R.avg[i]) * a;
      }
      const bands = BANDS[S.res];
      for (let b = 0; b < bands.length; b++) {
        let s = 0; for (let i = bands[b].i0; i < bands[b].i1; i++) s += R.avg[i];
        const db = pToDb(s * cal); R.disp[b] = db; if (db > R.peak[b]) R.peak[b] = db;
      }
    }
    // ---- spectrogram (fast, selected weighting) ----
    if (!R.specPaused) {
      const a = 1 - Math.exp(-dt / 0.06);
      for (let i = 0; i < NF; i++) { R.spec[i] += (RAW[i] * wt[i] - R.spec[i]) * a; R.rowAcc[i] += R.spec[i] * dt; }
      R.rowT += dt;
      const rowDur = S.specSpan / SPEC_ROWS;
      if (R.rowT >= rowDur) {
        let n = Math.min(4, Math.floor(R.rowT / rowDur));
        for (let i = 0; i < NF; i++) R.rowAcc[i] /= R.rowT;
        while (n-- > 0) pushSpecRow(R.rowAcc, cal);
        R.rowAcc.fill(0); R.rowT = 0;
      }
    }
    // ---- SPL ----
    const inst = { Z: pZ * cal, A: pA * cal, C: pC * cal };
    L.inst = inst;
    if (!L.init) { for (const w of W3) for (const t of T2) { L.tw[w + t] = inst[w]; L.max[w + t] = -300; L.min[w + t] = 300; } L.init = true; }
    L.T += dt;
    for (const w of W3) {
      L.E[w] += inst[w] * dt;
      for (const t of T2) {
        const k = w + t; L.tw[k] += (inst[w] - L.tw[k]) * (1 - Math.exp(-dt / TAU[t]));
        const db = pToDb(L.tw[k]);
        if (db > L.max[k]) L.max[k] = db;
        if (L.T > 1.5 && db < L.min[k]) L.min[k] = db;
      }
    }
    L.histAcc += dt;
    while (L.histAcc >= 0.1) {
      L.histAcc -= 0.1;
      for (const w of W3) for (const t of T2) L.hist[w + t][L.histI] = pToDb(L.tw[w + t]);
      L.histI = (L.histI + 1) % L.histN; L.histCount = Math.min(L.histN, L.histCount + 1);
    }
  }

  // ---------------- canvases ----------------
  const DPR = () => Math.min(window.devicePixelRatio || 1, 3);
  function fit(cv) {
    const r = cv.getBoundingClientRect(), d = DPR();
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; cv._grad = null; }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    return { g, W: r.width, H: r.height };
  }
  const C = { teal: '#1A8FC0', tealHi: '#2BB3E8', steel: '#6F86B8', lav: '#A98BD0', lavHi: '#C3AEEA', amber: '#FFB020', red: '#FF4D4F', green: '#3DDC84', grid: '#141C27', grid2: '#1C2635', label: '#66758A' };
  const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  const AXIS_F = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const AXIS_LBL = ['31', '63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

  function freqGrid(g, x0, y0, pw, ph) {
    g.lineWidth = 1;
    for (const f of [20, 30, 40, 50, 70, 80, 90, 200, 300, 400, 600, 700, 800, 900, 3000, 5000, 6000, 7000, 9000, 20000]) {
      const x = Math.round(x0 + xNorm(f) * pw) + 0.5; g.strokeStyle = C.grid; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + ph); g.stroke();
    }
    for (const f of AXIS_F) {
      const x = Math.round(x0 + xNorm(f) * pw) + 0.5;
      g.strokeStyle = f === 1000 ? '#24324A' : C.grid2; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + ph); g.stroke();
    }
  }
  function freqLabels(g, x0, y, pw) {
    g.font = `500 10px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'top';
    AXIS_F.forEach((f, j) => { g.fillStyle = f === 1000 ? '#8D9BB0' : C.label; g.fillText(AXIS_LBL[j], Math.round(x0 + xNorm(f) * pw) + 0.5, y); });
  }

  // cursor (touch / mouse) readout
  const CURSOR = { rta: null, spectro: null };
  function bindCursor(cv, key) {
    const set = e => { const r = cv.getBoundingClientRect(); CURSOR[key] = { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', e => { set(e); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) set(e); });
    cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') CURSOR[key] = null; });
    cv.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') CURSOR[key] = null; });
  }

  function drawRTA() {
    const cv = $('#rtaCanvas'); const { g, W, H } = fit(cv);
    const Lm = 34, Rm = 8, Tm = 10, Bm = 22, pw = W - Lm - Rm, ph = H - Tm - Bm;
    const top = S.rtaTop, range = S.rtaRange, bot = top - range;
    const y = db => Tm + (top - db) / range * ph, x = f => Lm + xNorm(f) * pw;
    g.fillStyle = '#070A0E'; g.fillRect(0, 0, W, H);
    // dB grid
    g.font = `500 10px ${MONO}`; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let db = bot; db <= top; db += 5) {
      const yy = Math.round(y(db)) + 0.5, major = db % 10 === 0;
      g.strokeStyle = major ? C.grid2 : C.grid; g.lineWidth = 1; g.beginPath(); g.moveTo(Lm, yy); g.lineTo(Lm + pw, yy); g.stroke();
      if (major) { g.fillStyle = C.label; g.fillText(String(db), Lm - 6, yy); }
    }
    freqGrid(g, Lm, Tm, pw, ph); freqLabels(g, Lm, Tm + ph + 6, pw);
    g.save(); g.beginPath(); g.rect(Lm, Tm, pw, ph); g.clip();
    // bars
    if (!cv._grad || cv._gradKey !== H + ':' + top) {
      const gr = g.createLinearGradient(0, Tm + ph, 0, Tm);
      gr.addColorStop(0, '#0B3550'); gr.addColorStop(0.45, '#1A8FC0'); gr.addColorStop(0.74, '#3FC1EE'); gr.addColorStop(0.87, C.amber); gr.addColorStop(1, C.red);
      cv._grad = gr; cv._gradKey = H + ':' + top;
    }
    const bands = BANDS[S.res], gap = S.res >= 12 ? 1 : S.res >= 6 ? 1.5 : 2.5;
    g.fillStyle = cv._grad;
    for (let b = 0; b < bands.length; b++) {
      const lv = R.disp[b]; if (lv <= bot) continue;
      const x0 = x(bands[b].lo) + gap / 2, x1 = x(bands[b].hi) - gap / 2, yy = y(lv);
      g.fillRect(x0, yy, x1 - x0, Tm + ph - yy);
    }
    g.fillStyle = 'rgba(255,255,255,.16)';
    for (let b = 0; b < bands.length; b++) { const lv = R.disp[b]; if (lv <= bot) continue; const x0 = x(bands[b].lo) + gap / 2, x1 = x(bands[b].hi) - gap / 2; g.fillRect(x0, y(lv), x1 - x0, 1); }
    // peak hold
    g.fillStyle = C.amber;
    for (let b = 0; b < bands.length; b++) { const pk = R.peak[b]; if (pk <= bot) continue; const x0 = x(bands[b].lo) + gap / 2, x1 = x(bands[b].hi) - gap / 2; g.fillRect(x0, y(pk) - 1, x1 - x0, 2); }
    // smoothed curve: fractional-octave smoothing of the fine data, scaled to the displayed bandwidth
    if (S.showLine) {
      const per = 24 / S.res, half = Math.max(2, per / 2), cal = dbToP(S.calOffset);
      g.beginPath();
      let started = false, px = 0, py = 0;
      for (let i = 0; i < NF; i++) {
        let s = 0, wsum = 0;
        for (let j = Math.max(0, Math.floor(i - half)); j <= Math.min(NF - 1, Math.ceil(i + half)); j++) { const w = 1 - Math.abs(j - i) / (half + 1); s += R.avg[j] * w; wsum += w; }
        const lv = pToDb(s / wsum * per * cal), xx = x(fC[i]), yy = y(Math.max(lv, bot - 5));
        if (!started) { g.moveTo(xx, yy); started = true; } else g.quadraticCurveTo(px, py, (px + xx) / 2, (py + yy) / 2);
        px = xx; py = yy;
      }
      g.lineTo(px, py);
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = 'rgba(169,139,208,.35)'; g.lineWidth = 5; g.stroke();
      g.strokeStyle = '#E6DCFF'; g.lineWidth = 1.8; g.stroke();
    }
    // cursor
    const cur = CURSOR.rta;
    if (cur && cur.x >= Lm && cur.x <= Lm + pw) {
      const f = F_MIN * 2 ** ((cur.x - Lm) / pw * LOG_SPAN);
      let b = bands.findIndex(bd => f >= bd.lo && f < bd.hi); if (b < 0) b = bands.length - 1;
      const bd = bands[b], cx = (x(bd.lo) + x(bd.hi)) / 2;
      g.strokeStyle = 'rgba(232,238,246,.55)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cx, Tm); g.lineTo(cx, Tm + ph); g.stroke(); g.setLineDash([]);
      const txt = `${fmtHzU(S.res <= 3 ? bd.nominal : bd.fc)}  ${R.disp[b].toFixed(1)} dB`;
      g.font = `600 11px ${MONO}`; const tw = g.measureText(txt).width + 16;
      const bx = clamp(cx - tw / 2, Lm + 2, Lm + pw - tw - 2);
      g.fillStyle = 'rgba(18,26,37,.95)'; roundRect(g, bx, Tm + 6, tw, 22, 6); g.fill(); g.strokeStyle = '#2B3A50'; g.stroke();
      g.fillStyle = '#E8EEF6'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(txt, bx + 8, Tm + 17);
    }
    if (R.frozen) badge(g, Lm + pw - 8, Tm + 8, 'FROZEN', C.tealHi);
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function badge(g, xr, yt, txt, col) {
    g.font = `700 10px ${MONO}`; const w = g.measureText(txt).width + 14;
    g.fillStyle = 'rgba(7,10,14,.85)'; roundRect(g, xr - w, yt, w, 20, 5); g.fill(); g.strokeStyle = col; g.lineWidth = 1; g.stroke();
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, xr - w / 2, yt + 10.5);
  }

  // ---- spectrogram ring buffer ----
  const SPEC_ROWS = 600;
  const specOff = document.createElement('canvas'); specOff.width = NF; specOff.height = SPEC_ROWS;
  const specG = specOff.getContext('2d');
  specG.fillStyle = '#05070A'; specG.fillRect(0, 0, NF, SPEC_ROWS);
  const specRow = specG.createImageData(NF, 1);
  let specW = SPEC_ROWS - 1;
  const LUT = (() => {
    const stops = [[0, [5, 7, 10]], [0.16, [20, 28, 74]], [0.36, [26, 110, 170]], [0.52, [43, 179, 232]], [0.66, [61, 220, 132]], [0.8, [255, 210, 63]], [0.92, [255, 77, 79]], [1, [255, 236, 236]]];
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255; let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const [t0, c0] = stops[k], [t1, c1] = stops[k + 1], u = clamp((t - t0) / (t1 - t0), 0, 1);
      for (let j = 0; j < 3; j++) lut[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * u;
    }
    return lut;
  })();
  function pushSpecRow(pw, cal) {
    const top = S.rtaTop - 9, lo = top - S.specRange, d = specRow.data;  // fine bands sit ~9 dB below 1/3-oct levels
    for (let i = 0; i < NF; i++) {
      const v = clamp((pToDb(pw[i] * cal) - lo) / S.specRange, 0, 1), c = (v * 255) | 0;
      d[i * 4] = LUT[c * 3]; d[i * 4 + 1] = LUT[c * 3 + 1]; d[i * 4 + 2] = LUT[c * 3 + 2]; d[i * 4 + 3] = 255;
    }
    specG.putImageData(specRow, 0, specW);
    specW = (specW - 1 + SPEC_ROWS) % SPEC_ROWS;
  }
  function clearSpec() { specG.fillStyle = '#05070A'; specG.fillRect(0, 0, NF, SPEC_ROWS); }
  function drawSpec() {
    const cv = $('#specCanvas'); const { g, W, H } = fit(cv);
    const Lm = 34, Rm = 20, Tm = 8, Bm = 22, pw = W - Lm - Rm, ph = H - Tm - Bm;
    g.fillStyle = '#070A0E'; g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    const r0 = specW + 1, n1 = SPEC_ROWS - r0, sy = ph / SPEC_ROWS;
    if (n1 > 0) g.drawImage(specOff, 0, r0, NF, n1, Lm, Tm, pw, n1 * sy);
    if (r0 > 0) g.drawImage(specOff, 0, 0, NF, r0, Lm, Tm + n1 * sy, pw, r0 * sy);
    // overlays
    g.save(); g.globalAlpha = 0.12; freqGrid(g, Lm, Tm, pw, ph); g.restore(); freqLabels(g, Lm, Tm + ph + 6, pw);
    // time axis
    g.font = `500 10px ${MONO}`; g.fillStyle = C.label; g.textAlign = 'right'; g.textBaseline = 'middle';
    const span = S.specSpan, step = span <= 10 ? 2 : span <= 30 ? 5 : 10;
    for (let t = 0; t <= span; t += step) { const yy = Tm + t / span * ph; g.fillText((t === 0 ? '0' : '−' + t) + 's', Lm - 5, clamp(yy, Tm + 5, Tm + ph - 5)); g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(Lm, Math.round(yy), pw, 1); g.fillStyle = C.label; }
    // colour bar
    const cbx = W - Rm + 6, grd = g.createLinearGradient(0, Tm + ph, 0, Tm);
    for (let i = 0; i <= 8; i++) { const c = Math.round(i / 8 * 255); grd.addColorStop(i / 8, `rgb(${LUT[c * 3]},${LUT[c * 3 + 1]},${LUT[c * 3 + 2]})`); }
    g.fillStyle = grd; roundRect(g, cbx, Tm, 8, ph, 3); g.fill();
    const cur = CURSOR.spectro;
    if (cur && cur.x >= Lm && cur.x <= Lm + pw && cur.y >= Tm && cur.y <= Tm + ph) {
      const f = F_MIN * 2 ** ((cur.x - Lm) / pw * LOG_SPAN), t = (cur.y - Tm) / ph * span;
      g.strokeStyle = 'rgba(232,238,246,.6)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(cur.x, Tm); g.lineTo(cur.x, Tm + ph); g.moveTo(Lm, cur.y); g.lineTo(Lm + pw, cur.y); g.stroke(); g.setLineDash([]);
      const txt = `${fmtHzU(f)}  −${t.toFixed(1)} s`; g.font = `600 11px ${MONO}`; const tw = g.measureText(txt).width + 16;
      const bx = clamp(cur.x + 8, Lm + 2, Lm + pw - tw - 2), by = clamp(cur.y - 30, Tm + 4, Tm + ph - 26);
      g.fillStyle = 'rgba(18,26,37,.95)'; roundRect(g, bx, by, tw, 22, 6); g.fill(); g.fillStyle = '#E8EEF6'; g.textAlign = 'left'; g.fillText(txt, bx + 8, by + 11);
    }
    if (R.specPaused) badge(g, Lm + pw - 8, Tm + 8, 'PAUSED', C.lavHi);
  }

  function drawSPLHist() {
    const cv = $('#splCanvas'); const { g, W, H } = fit(cv);
    const Lm = 30, Rm = 8, Tm = 22, Bm = 18, pw = W - Lm - Rm, ph = H - Tm - Bm;
    const key = S.splW + S.splT, h = L.hist[key];
    // auto range around data
    let mx = -300, mn = 300;
    for (let j = 0; j < L.histCount; j++) { const v = h[(L.histI - 1 - j + L.histN) % L.histN]; if (v > mx) mx = v; if (v < mn) mn = v; }
    if (L.histCount === 0) { mx = 90; mn = 50; }
    let top = Math.ceil((mx + 5) / 10) * 10, bot = Math.floor((mn - 5) / 10) * 10; if (top - bot < 30) bot = top - 30;
    const y = v => Tm + (top - v) / (top - bot) * ph;
    g.fillStyle = '#070A0E'; g.fillRect(0, 0, W, H);
    g.font = `600 10px ${MONO}`; g.fillStyle = C.label; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('LEVEL HISTORY · 2 MIN', 10, 7);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let v = bot; v <= top; v += 10) { const yy = Math.round(y(v)) + 0.5; g.strokeStyle = C.grid2; g.lineWidth = 1; g.beginPath(); g.moveTo(Lm, yy); g.lineTo(Lm + pw, yy); g.stroke(); g.fillText(String(v), Lm - 5, yy); }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let s = 0; s <= 120; s += 30) { const xx = Lm + pw - s / 120 * pw; g.fillText(s === 0 ? 'now' : '−' + s + 's', clamp(xx, Lm + 12, Lm + pw - 12), Tm + ph + 5); }
    if (85 > bot && 85 < top) {
      const yy = Math.round(y(85)) + 0.5; g.strokeStyle = 'rgba(255,176,32,.6)'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(Lm, yy); g.lineTo(Lm + pw, yy); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.amber; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('85 dB', Lm + 4, yy - 2);
    }
    const n = L.histCount; if (n < 2) return;
    g.save(); g.beginPath(); g.rect(Lm, Tm, pw, ph); g.clip();
    g.beginPath();
    for (let j = 0; j < n; j++) { const v = h[(L.histI - 1 - j + L.histN) % L.histN], xx = Lm + pw - j / (L.histN - 1) * pw, yy = y(v); if (j === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy); }
    const xEnd = Lm + pw - (n - 1) / (L.histN - 1) * pw;
    g.strokeStyle = C.tealHi; g.lineWidth = 1.6; g.lineJoin = 'round'; g.stroke();
    g.lineTo(xEnd, Tm + ph); g.lineTo(Lm + pw, Tm + ph); g.closePath();
    const fg = g.createLinearGradient(0, Tm, 0, Tm + ph); fg.addColorStop(0, 'rgba(43,179,232,.32)'); fg.addColorStop(1, 'rgba(43,179,232,0)'); g.fillStyle = fg; g.fill();
    g.restore();
  }

  const genFine = new Float64Array(NF);
  function drawGenSpec() {
    const cv = $('#genCanvas'); const { g, W, H } = fit(cv);
    const Lm = 30, Rm = 4, Tm = 4, Bm = 16, pw = W - Lm - Rm, ph = H - Tm - Bm, top = 0, range = 80;
    const y = db => Tm + (top - db) / range * ph, x = f => Lm + xNorm(f) * pw;
    g.fillStyle = '#070A0E'; g.fillRect(0, 0, W, H);
    g.font = `500 9px ${MONO}`; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let db = top; db >= top - range; db -= 20) { const yy = Math.round(y(db)) + 0.5; g.strokeStyle = C.grid2; g.lineWidth = 1; g.beginPath(); g.moveTo(Lm, yy); g.lineTo(Lm + pw, yy); g.stroke(); g.fillStyle = C.label; g.fillText(String(db), Lm - 5, yy); }
    freqGrid(g, Lm, Tm, pw, ph); g.font = `500 9px ${MONO}`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    AXIS_F.forEach((f, j) => { if (j % 2 === 1 || f === 16000) { g.fillStyle = C.label; g.fillText(AXIS_LBL[j], x(f), Tm + ph + 4); } });
    if (!(A.genPlaying && A.ctx && A.ctx.state === 'running')) {
      g.font = `600 11px ${MONO}`; g.fillStyle = C.label; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SIGNAL OFF · dBFS', Lm + pw / 2, Tm + ph / 2); return;
    }
    analyserToFine(A.genAn, A.mapGen, genFine, 1);
    const bands = BANDS[3]; g.fillStyle = C.teal;
    const gr = g.createLinearGradient(0, Tm + ph, 0, Tm); gr.addColorStop(0, '#0B3550'); gr.addColorStop(0.6, C.teal); gr.addColorStop(1, C.lavHi); g.fillStyle = gr;
    for (const bd of bands) { let s = 0; for (let i = bd.i0; i < bd.i1; i++) s += genFine[i]; const lv = pToDb(s); if (lv <= top - range) continue; const x0 = x(bd.lo) + 1.5, x1 = x(bd.hi) - 1.5, yy = y(Math.min(lv, top)); g.fillRect(x0, yy, x1 - x0, Tm + ph - yy); }
  }

  // ---------------- UI ----------------
  let screen = Q.get('screen') || 'rta';
  function show(name) {
    if (!$(`.screen[data-screen="${name}"]`)) name = 'rta';
    screen = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    if (name === 'settings') updateInputInfo();
  }
  function bindSeg(seg) {
    const key = seg.dataset.key;
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const raw = b.dataset.v, v = typeof DEFAULTS[key] === 'number' ? Number(raw) : raw;
      const changed = S[key] !== v; S[key] = v; save(); syncSegs();
      onSetting(key, changed);
    });
  }
  function syncSegs() { $$('[data-key]').forEach(seg => { const v = String(S[seg.dataset.key]); $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === v)); }); }
  function onSetting(key, changed) {
    if (key === 'res') { R.peak.fill(-300); }
    if (key === 'weight' && changed) { R.init = false; R.sum.fill(0); R.sumT = 0; R.peak.fill(-300); }
    if (key === 'avg') { R.sum.fill(0); R.sumT = 0; R.init = false; R.peak.fill(-300); }
    if (key === 'genType') {
      S.genLevel = Math.min(S.genLevel, genMaxLevel()); save();
      if (A.genPlaying) { buildGenSource(); applyGenLevel(); }
      uiGen();
    }
    if (key === 'sweepDur' && A.genPlaying && S.genType === 'sweep') { buildGenSource(); }
    if (key === 'specRange' || key === 'rtaTop') clearSpec();
    if (key === 'calRef') uiCal();
  }

  let toastT = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3600); }

  function setSource(src) {
    A.src = src;
    const chip = $('#srcChip'); chip.classList.toggle('mic', src === 'mic');
    $('#srcLabel').textContent = src === 'mic' ? 'MIC' : 'SIM';
    $('#micToggle').textContent = src === 'mic' ? 'Use simulated signal' : 'Use microphone';
    $('#micToggle').classList.toggle('accent', src !== 'mic');
    updateInputInfo();
  }
  function updateInputInfo() {
    const mic = A.src === 'mic';
    $('#setSource').textContent = mic ? (A.deviceLabel || 'Microphone') : 'Simulated signal';
    $('#setRate').textContent = A.ctx ? (A.ctx.sampleRate / 1000).toFixed(1).replace(/\.0$/, '') + ' kHz' : '48 kHz (simulated)';
    const sr = A.ctx ? A.ctx.sampleRate : 48000;
    $('#setFFT').textContent = `8192-pt FFT · ${(8192 / sr * 1000).toFixed(0)} ms · Blackman`;
    $('#setCh').textContent = mic && A.trackSettings && A.trackSettings.channelCount ? String(A.trackSettings.channelCount) + (A.trackSettings.channelCount === 1 ? ' (mono)' : '') : mic ? '1 (mono)' : '1 (simulated)';
  }

  // ---- generator UI ----
  const sliderToHz = v => 20 * 1000 ** (v / 1000), hzToSlider = f => Math.round(1000 * Math.log(f / 20) / Math.log(1000));
  function setRangeFill(el) { const p = (el.value - el.min) / (el.max - el.min) * 100; el.style.setProperty('--p', p + '%'); }
  function uiGen() {
    $$('.gen-card').forEach(c => c.classList.toggle('show', c.dataset.for === S.genType));
    const fr = $('#genFreq'); fr.value = hzToSlider(S.genFreq); setRangeFill(fr);
    $('#genFreqTxt').textContent = fmtHzU(S.genFreq);
    $$('[data-preset]').forEach(b => b.classList.toggle('on', Math.abs(Number(b.dataset.preset) - S.genFreq) < 0.5));
    const lv = $('#genLevel'); lv.max = genMaxLevel(); lv.value = S.genLevel; setRangeFill(lv);
    $('#genLevelTxt').textContent = (S.genLevel < 0 ? '−' : '') + Math.abs(S.genLevel).toFixed(1) + ' dBFS';
    $('#genLevelKind').textContent = 'RMS';
    const p = $('#genPlay'); p.classList.toggle('on', A.genPlaying); $('#genPlayTxt').textContent = A.genPlaying ? 'Stop signal' : 'Start signal';
  }
  function setGenFreq(f) {
    S.genFreq = clamp(Math.round(f * 100) / 100, 20, 20000); save();
    if (A.genPlaying && S.genType === 'sine' && A.genNode) A.genNode.frequency.setTargetAtTime(S.genFreq, A.ctx.currentTime, 0.008);
    uiGen();
  }

  // ---- calibration ----
  function startCal() {
    if (A.src !== 'mic') { toast('Switch to the microphone first, then calibrate with your reference source.'); return; }
    CAL.on = true; CAL.t = 0; CAL.acc = 0; $('#calProg').classList.add('on'); $('#calBtn').textContent = 'Measuring…';
  }
  function finishCal() {
    CAL.on = false; $('#calProg').classList.remove('on'); $('#calBtn').textContent = 'Calibrate to reference';
    const meanDb = pToDb(CAL.acc / CAL.t);
    if (meanDb < -100) { toast('No signal detected. Check the calibrator and try again.'); return; }
    const off = S.calRef - meanDb;
    S.calOffset = Math.round(off * 10) / 10; S.calDate = new Date().toISOString(); save(); resetAll(); uiCal();
    toast(`Calibrated: offset ${S.calOffset.toFixed(1)} dB (input read ${meanDb.toFixed(1)} dBFS at ${S.calRef} dB SPL).`);
  }
  function uiCal() {
    $('#calOffTxt').textContent = S.calOffset.toFixed(1) + ' dB';
    const st = $('#calStatus'), sc = $('#splCal');
    if (S.calDate) {
      const d = new Date(S.calDate);
      st.textContent = 'Calibrated ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      sc.textContent = 'Calibrated'; sc.classList.add('ok');
    } else if (S.calOffset !== DEFAULTS.calOffset) { st.textContent = 'Manual offset'; sc.textContent = 'Manual offset'; sc.classList.remove('ok'); }
    else { st.textContent = 'Uncalibrated (default offset)'; sc.textContent = A.src === 'mic' ? 'Uncalibrated' : 'Simulated input'; sc.classList.remove('ok'); }
  }

  // ---- per-frame text readouts (throttled for legibility) ----
  let lastText = 0;
  const f1 = v => (v < -200 ? '--.-' : v.toFixed(1));
  function updateText(now) {
    // input meter
    const inDb = clamp(L.inPeak, -60, 0); $('#inFill').style.width = ((inDb + 60) / 60 * 100).toFixed(1) + '%';
    if (now - lastText < 110) return; lastText = now;
    if (screen === 'rta') {
      let tot = 0; for (let i = 0; i < NF; i++) tot += R.avg[i];
      $('#rtaOverall').textContent = f1(pToDb(tot * dbToP(S.calOffset)));
      $('#rtaOverallU').textContent = `dB(${S.weight})`;
      const bands = BANDS[S.res]; let bi = 0; for (let b = 1; b < bands.length; b++) if (R.disp[b] > R.disp[bi]) bi = b;
      $('#rtaPeakF').textContent = fmtHzU(S.res <= 3 ? bands[bi].nominal : bands[bi].fc);
      $('#rtaPeakL').textContent = f1(R.disp[bi]) + ' dB';
      $('#rtaAvgK').textContent = S.avg === 'inf' ? 'Inf' : S.avg === 'fast' ? 'Fast' : 'Slow';
      $('#rtaAvgT').textContent = S.avg === 'inf' ? fmtDur(R.sumT) : S.avg === 'fast' ? 'τ 125 ms' : 'τ 1 s';
    } else if (screen === 'spl') {
      const k = S.splW + S.splT, lv = pToDb(L.tw[k]);
      $('#splValue').textContent = f1(lv);
      const T = S.splT === 'fast' ? 'F' : 'S';
      $('#splTag').textContent = 'L' + S.splW + T;
      $('#kLeq').textContent = 'L' + S.splW + 'eq'; $('#kMax').textContent = 'L' + S.splW + T + 'max'; $('#kMin').textContent = 'L' + S.splW + T + 'min';
      $('#sLeq').textContent = f1(L.T > 0 ? pToDb(L.E[S.splW] / L.T) : -300);
      $('#sMax').textContent = f1(L.max[k]); $('#sMin').textContent = L.min[k] > 299 ? '--.-' : f1(L.min[k]);
      $('#sDur').textContent = fmtDur(L.T, true);
    } else if (screen === 'spectro') {
      let bi = 0; for (let i = 1; i < NF; i++) if (R.spec[i] > R.spec[bi]) bi = i;
      // parabolic interpolation on dB for a finer frequency estimate
      let f = fC[bi];
      if (bi > 0 && bi < NF - 1) { const a = pToDb(R.spec[bi - 1]), b = pToDb(R.spec[bi]), c = pToDb(R.spec[bi + 1]), den = a - 2 * b + c; if (den < 0) f = fC[bi] * 2 ** (clamp(0.5 * (a - c) / den, -0.5, 0.5) / 24); }
      $('#spF').textContent = fmtHzU(f);
      $('#spL').textContent = f1(pToDb(R.spec[bi] * dbToP(S.calOffset))) + ' dB';
      $('#spSpan').textContent = S.specSpan + ' s';
      const top = S.rtaTop - 9; $('#spScale').textContent = `${top - S.specRange}–${top}`; $('#spScaleU').textContent = `dB(${S.weight})`;
    } else if (screen === 'gen') {
      if (A.genPlaying && A.ctx) {
        A.genAn.getFloatTimeDomainData(A.genTd); let e = 0; for (let i = 0; i < A.genTd.length; i++) e += A.genTd[i] * A.genTd[i];
        const db = pToDb(e / A.genTd.length);
        $('#outFill').style.width = clamp((db + 60) / 60 * 100, 0, 100).toFixed(1) + '%';
        $('#outTxt').textContent = 'Output ' + (db < -100 ? '−∞' : '−' + Math.abs(db).toFixed(1)) + ' dBFS RMS';
      } else { $('#outFill').style.width = '0%'; $('#outTxt').textContent = 'Output off'; }
    }
    if (screen === 'gen' && S.genType === 'sweep') {
      let f = 20;
      if (A.genPlaying && A.ctx) { const t = A.ctx.currentTime - A.sweepT0; if (t >= 0) f = 20 * 1000 ** ((t % S.sweepDur) / S.sweepDur); }
      $('#sweepNow').textContent = fmtHzU(f);
      $('#sweepPos').style.left = `calc(${(Math.log(f / 20) / Math.log(1000) * 100).toFixed(2)}% - 2px)`;
    }
    if (screen === 'spl') { const k = S.splW + S.splT, lv = pToDb(L.tw[k]); setMeter(lv, L.max[k]); }
  }
  function setMeter(lv, mx) {
    const pos = v => clamp((v - 30) / 100, 0, 1) * 100;
    $('#splFill').style.width = pos(lv).toFixed(2) + '%';
    $('#splPeak').style.left = `calc(${pos(mx).toFixed(2)}% - 1px)`;
  }
  function fmtDur(s, hours) { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; const p = n => String(n).padStart(2, '0'); return hours || h ? `${p(h)}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`; }

  // ---------------- main loop ----------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 1 / 60; if (dt > 0.2) dt = 0.2;
    try {
      process(dt);
      if (screen === 'rta') drawRTA(); else if (screen === 'spectro') drawSpec(); else if (screen === 'spl') drawSPLHist(); else if (screen === 'gen') drawGenSpec();
      updateText(now);
    } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }

  // ---------------- wiring ----------------
  function init() {
    const framed = Q.get('frame') === '1' || (Q.get('frame') !== '0' && window.innerWidth > 520 && window.innerHeight > 600);
    document.body.classList.toggle('framed', framed);
    if (Q.get('status') === '1') document.body.classList.add('status');
    if (Q.has('shot')) document.body.classList.add('shot');
    const fitDevice = () => { if (!document.body.classList.contains('framed')) return; const s = Math.min(1, (window.innerHeight - 70) / 868, (window.innerWidth - 24) / 414); $('#device').style.transform = `scale(${s})`; };
    fitDevice(); window.addEventListener('resize', fitDevice);

    $$('.seg, .seg-tiles').forEach(bindSeg); syncSegs();
    $$('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    $('#srcChip').addEventListener('click', () => (A.src === 'mic' ? disableMic() : enableMic()));
    $('#micToggle').addEventListener('click', () => (A.src === 'mic' ? disableMic() : enableMic()));
    $('#freezeBtn').addEventListener('click', () => { R.frozen = !R.frozen; $('#freezeBtn').classList.toggle('on', R.frozen); $('#freezeBtn span').textContent = R.frozen ? 'Frozen' : 'Freeze'; });
    $('#peakResetBtn').addEventListener('click', resetPeaks);
    const lineBtn = $('#lineBtn'); lineBtn.setAttribute('aria-pressed', String(S.showLine));
    lineBtn.addEventListener('click', () => { S.showLine = !S.showLine; save(); lineBtn.setAttribute('aria-pressed', String(S.showLine)); });
    $('#splReset').addEventListener('click', resetSPL);
    $('#specPause').addEventListener('click', () => { R.specPaused = !R.specPaused; $('#specPause').classList.toggle('on', R.specPaused); $('#specPause span').textContent = R.specPaused ? 'Resume' : 'Pause'; });
    $('#specClear').addEventListener('click', clearSpec);
    const fr = $('#genFreq'); fr.addEventListener('input', () => setGenFreq(sliderToHz(Number(fr.value))));
    $$('[data-preset]').forEach(b => b.addEventListener('click', () => setGenFreq(Number(b.dataset.preset))));
    $$('[data-step]').forEach(b => b.addEventListener('click', () => {
      const n = Math.round(3 * Math.log2(S.genFreq / 1000)) + Number(b.dataset.step);
      const f = 1000 * 2 ** (n / 3); const nom = NOMINAL.find(v => Math.abs(Math.log(v / f)) < 0.03); setGenFreq(nom || f);
    }));
    const lv = $('#genLevel'); lv.addEventListener('input', () => { S.genLevel = Number(lv.value); save(); applyGenLevel(); uiGen(); });
    $('#genPlay').addEventListener('click', () => (A.genPlaying ? genStop() : genStart()));
    $$('[data-cal]').forEach(b => b.addEventListener('click', () => { S.calOffset = Math.round((S.calOffset + Number(b.dataset.cal)) * 10) / 10; S.calDate = null; save(); uiCal(); resetPeaks(); }));
    $('#calBtn').addEventListener('click', startCal);
    $('#calResetBtn').addEventListener('click', () => { S.calOffset = DEFAULTS.calOffset; S.calDate = null; save(); uiCal(); resetAll(); toast('Default offset restored (120.0 dB).'); });
    $('#devSelect').addEventListener('change', e => { S.deviceId = e.target.value; save(); if (A.src === 'mic') enableMic(); });
    bindCursor($('#rtaCanvas'), 'rta'); bindCursor($('#specCanvas'), 'spectro');
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const tabs = ['rta', 'spl', 'spectro', 'gen', 'settings'];
      if (e.key >= '1' && e.key <= '5') show(tabs[Number(e.key) - 1]);
      else if (e.key === 'f' || e.key === 'F') $('#freezeBtn').click();
      else if (e.key === 'r' || e.key === 'R') resetPeaks();
      else if (e.key === 'm' || e.key === 'M') $('#srcChip').click();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && A.ctx && A.ctx.state === 'suspended') A.ctx.resume().catch(() => {}); });
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', listDevices);

    // screenshot / demo parameters
    for (const k of Object.keys(DEFAULTS)) if (Q.has(k) && k !== 'calDate' && k !== 'deviceId') { const v = Q.get(k); S[k] = typeof DEFAULTS[k] === 'number' ? Number(v) : typeof DEFAULTS[k] === 'boolean' ? v === '1' : v; }
    syncSegs(); $('#lineBtn').setAttribute('aria-pressed', String(S.showLine));
    setSource('sim'); uiGen(); uiCal(); show(screen);
    const warm = Number(Q.get('prewarm') || 0);
    if (Q.get('play') === '1') genStart();
    if (warm > 0) { for (let t = 0; t < warm; t += 1 / 60) process(1 / 60); if (Q.has('freeze')) $('#freezeBtn').click(); }
    if (Q.get('mic') === '1') enableMic();
    requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); });
  }
  window.PocketRTA = { S, A, R, L, BANDS, show, enableMic, genStart, genStop, resetAll };
  init();
})();
