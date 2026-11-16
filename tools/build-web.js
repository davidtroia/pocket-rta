// Copies only the files the app loads at runtime into www/, which Capacitor packs into the iOS app.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets', 'brand'), { recursive: true });
for (const f of ['index.html', 'css', 'js', 'fonts']) fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });
fs.cpSync(path.join(root, 'assets', 'icon'), path.join(out, 'assets', 'icon'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'assets', 'brand'))) if (f.endsWith('.svg')) fs.copyFileSync(path.join(root, 'assets', 'brand', f), path.join(out, 'assets', 'brand', f));
console.log('www/ ready');
