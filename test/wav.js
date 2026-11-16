// Tiny WAV writer for test fixtures (16-bit mono PCM). Fixtures are generated at test time, not stored.
const fs = require('fs');
const SR = 48000;
function writeWav(file, samples) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
const amp = dbfsRms => Math.SQRT2 * Math.pow(10, dbfsRms / 20);   // sine amplitude for a given RMS in dBFS
const sine = (f, dbfsRms, sec, phase = 0) => { const a = amp(dbfsRms), n = Math.round(sec * SR), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a * Math.sin(2 * Math.PI * f * i / SR + phase); return o; };
const silence = sec => new Float32Array(Math.round(sec * SR));
function whiteNoise(dbfsRms, sec) { // seeded Gaussian, RMS-normalised
  let s = 12345; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = Math.round(sec * SR), o = new Float32Array(n); let e = 0;
  for (let i = 0; i < n; i += 1) { const u = Math.max(r(), 1e-12), v = r(); o[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); e += o[i] * o[i]; }
  const g = Math.pow(10, dbfsRms / 20) / Math.sqrt(e / n); for (let i = 0; i < n; i++) o[i] *= g; return o;
}
const concat = (...a) => { const o = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
module.exports = { writeWav, sine, silence, whiteNoise, concat, SR };
