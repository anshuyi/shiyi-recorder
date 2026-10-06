import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const base = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
const cache = path.join(root, '.tmp/public-media');
const assets = {
  'ffmpeg-win32-x64.gz': '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  'ffprobe-win32-x64.gz': 'f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d',
  'win32-x64.LICENSE': '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
  'win32-x64.README': 'a636a7183c58006351acbaf35303c0ed85c6e1320fd4e80de453ba6157de6311',
};
function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= 5) return reject(new Error('Too many media download redirects'));
        resolve(download(new URL(response.headers.location, url), redirects + 1)); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Media download HTTP ${response.statusCode}`)); return; }
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
    });
    request.setTimeout(60000, () => request.destroy(new Error('Media download timed out')));
    request.on('error', reject);
  });
}
await fs.mkdir(cache, { recursive: true });
for (const [name, digest] of Object.entries(assets)) {
  const cached = path.join(cache, name);
  const data = await fs.readFile(cached).catch(async error => {
    if (error.code !== 'ENOENT') throw error;
    return download(base + name);
  });
  if (createHash('sha256').update(data).digest('hex') !== digest) throw new Error(`Media checksum mismatch: ${name}`);
  await fs.writeFile(cached, data);
  if (name.endsWith('.gz')) {
    const destination = name.startsWith('ffmpeg')
      ? path.join(root, 'node_modules/ffmpeg-static/ffmpeg.exe')
      : path.join(root, 'node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, gunzipSync(data));
  }
}
console.log('Prepared verified FFmpeg and FFprobe 6.1.1 Windows x64 binaries and notices.');
