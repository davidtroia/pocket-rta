// Rasterises the SVG masters into every required PNG size (sharp / librsvg), lossless + max compression.
const sharp = require('sharp'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), A = p => path.join(ROOT, 'assets', p);
const png = s => s.png({ compressionLevel: 9, adaptiveFiltering: true});
async function svgToPng(src, out, w, h) {
  const svg = fs.readFileSync(A(src));
  const meta = await sharp(svg).metadata();
  const density = Math.ceil(72 * Math.max(w / meta.width, (h || w) / meta.height) * 1.02);
  let img = sharp(svg, { density: Math.min(density, 4800) }).resize(w, h || null, { fit: 'fill' });
  if (/ios|store/.test(out)) img = img.flatten({ background: '#05080D' }); // App Store icons must be opaque
  await png(img).toFile(A(out)); console.log(out);
}
(async () => {
  const ios = [1024, 180, 167, 152, 120, 87, 80, 76, 58, 40, 29];
  for (const s of ios) await svgToPng('icon/pocket-rta-icon.svg', `icon/ios/icon-${s}.png`, s, s);
  await svgToPng('icon/pocket-rta-icon.svg', 'icon/pocket-rta-icon-1024-appstore.png', 1024, 1024);
  await svgToPng('icon/pocket-rta-icon.svg', 'icon/android/playstore-icon-512.png', 512, 512);
  await svgToPng('icon/pocket-rta-icon-rounded.svg', 'icon/web/icon-192.png', 192, 192);
  await svgToPng('icon/pocket-rta-icon-rounded.svg', 'icon/web/icon-512.png', 512, 512);
  await svgToPng('icon/pocket-rta-icon-rounded.svg', 'icon/pocket-rta-icon-rounded-1024.png', 1024, 1024);
  for (const l of ['foreground', 'background', 'monochrome']) await svgToPng(`icon/android/adaptive-${l}.svg`, `icon/android/adaptive-${l}-432.png`, 432, 432);
  // legacy launcher densities (mdpi..xxxhdpi) from the rounded icon
  for (const [d, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) await svgToPng('icon/pocket-rta-icon-rounded.svg', `icon/android/ic_launcher-${d}-${s}.png`, s, s);
  for (const v of ['dark', 'light']) {
    const svg = fs.readFileSync(A(`logo/pocket-rta-wordmark-${v}.svg`)), m = await sharp(svg).metadata();
    await svgToPng(`logo/pocket-rta-wordmark-${v}.svg`, `logo/pocket-rta-wordmark-${v}-4096.png`, 4096, Math.round(4096 * m.height / m.width));
  }
  for (const v of ['balance-digital-logo-dark', 'balance-digital-logo-light', 'balance-digital-waveform-logo']) {
    const svg = fs.readFileSync(A(`brand/${v}.svg`)), m = await sharp(svg).metadata();
    await svgToPng(`brand/${v}.svg`, `brand/${v}-4096.png`, 4096, Math.round(4096 * m.height / m.width));
  }
  await svgToPng('icon/pocket-rta-mark.svg', 'logo/pocket-rta-mark-2048.png', 2048, 2048);
})();
