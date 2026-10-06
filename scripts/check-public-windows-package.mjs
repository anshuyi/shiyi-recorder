import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { listPackage } = require('@electron/asar');
const resources = path.resolve(process.argv[2] ?? 'release/win-unpacked/resources');
const entries = listPackage(path.join(resources, 'app.asar'));
if (entries.some(entry => /[\\/](?:outputs|recordings|\.tmp|\.git)[\\/]/i.test(entry))) throw new Error('Private path included in app archive');
if (entries.some(entry => /recordly-nvidia-cuda-compositor\.exe$/.test(entry))) throw new Error('Unverified CUDA binary included');
const wallpaper = fs.readdirSync(path.join(resources, 'assets/wallpapers'));
if (wallpaper.length !== 1 || wallpaper[0] !== 'paper-collage.png') throw new Error('Unexpected public wallpaper');
for (const binary of ['wgc-capture.exe', 'cursor-monitor.exe', 'recordly-gpu-export.exe', 'whisper-cli.exe']) {
  const data = fs.readFileSync(path.join(resources, 'app.asar.unpacked/electron/native/bin/win32-x64', binary));
  for (const encoding of ['utf8', 'utf16le']) {
    if (/C:[\\/]Users[\\/]/i.test(data.toString(encoding))) throw new Error(`Build user path found in ${binary}`);
  }
}
for (const file of ['LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'third-party/FFmpeg-6.1.1-LICENSE.txt',
  'third-party/whisper.cpp-1.8.4-LICENSE.txt', 'third-party/MediaPipe-Apache-2.0.txt', 'third-party/npm-license-index.json']) {
  if (!fs.existsSync(path.join(resources, 'licenses', file))) throw new Error(`Missing packaged notice: ${file}`);
}
console.log(`Public Windows package audit passed (${entries.length} archive entries).`);
