import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'build/licenses');
fs.mkdirSync(out, { recursive: true });
for (const name of ['LICENSE', 'README']) {
  fs.copyFileSync(path.join(root, `.tmp/public-media/win32-x64.${name}`), path.join(out, `FFmpeg-6.1.1-${name}.txt`));
}
const whisperSource = path.join(root, '.tmp/whisper-runtime/src-v1.8.4/whisper.cpp-1.8.4');
fs.copyFileSync(path.join(whisperSource, 'LICENSE'), path.join(out, 'whisper.cpp-1.8.4-LICENSE.txt'));
// This upstream archive licenses the vendored ggml under its root LICENSE.
fs.copyFileSync(path.join(whisperSource, 'LICENSE'), path.join(out, 'ggml-LICENSE.txt'));
fs.copyFileSync(path.join(root, 'public/mediapipe/LICENSE-APACHE-2.0.txt'), path.join(out, 'MediaPipe-Apache-2.0.txt'));
for (const name of ['COPYING.md', 'COPYING.LESSER.md']) {
  fs.copyFileSync(path.join(root, 'node_modules/uiohook-napi/libuiohook', name), path.join(out, `libuiohook-${name}`));
}
const index = [];
function collect(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const packageDirectory = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) { collect(packageDirectory); continue; }
    const packageFile = path.join(packageDirectory, 'package.json');
    if (!fs.existsSync(packageFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const licenses = fs.readdirSync(packageDirectory).filter(name => /^(license|licence|copying|notice)([.-]|$)/i.test(name)
      && fs.statSync(path.join(packageDirectory, name)).isFile());
    const packageOut = path.join(out, 'npm', `${pkg.name.replaceAll('/', '_')}@${pkg.version}`);
    fs.mkdirSync(packageOut, { recursive: true });
    for (const license of licenses) fs.copyFileSync(path.join(packageDirectory, license), path.join(packageOut, license));
    index.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? 'See package source', repository: pkg.repository ?? null, files: licenses });
    collect(path.join(packageDirectory, 'node_modules'));
  }
}
collect(path.join(root, 'node_modules'));
fs.writeFileSync(path.join(out, 'npm-license-index.json'), JSON.stringify(index, null, 2));
console.log(`Prepared runtime license notices and ${index.length} dependency entries.`);
