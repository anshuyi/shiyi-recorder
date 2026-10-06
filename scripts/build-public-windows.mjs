import { verifyNativeHelperManifest, formatNativeHelperManifestWarning } from './native-helper-manifest.mjs';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import JSON5 from 'json5';
import { normalizeWindowsEnvironment, publicWindowsConfig } from './lib/public-windows-profile.mjs';
const root = path.resolve(import.meta.dirname, '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('首发构建目前仅支持 Windows x64');
const preview = process.argv.includes('--preview');
const childEnvironment = normalizeWindowsEnvironment(process.env);
childEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
childEnvironment.PACKAGED_SMOKE_OPTIONAL_CUDA = '1';
// VS can be installed outside Program Files; discover rather than hard-code a machine path.
const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
if (fs.existsSync(vswhere)) {
  const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).trim();
  if (installation) {
    const cmakeBin = path.join(installation, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin');
    if (fs.existsSync(path.join(cmakeBin, 'cmake.exe'))) childEnvironment.PATH = `${cmakeBin}${path.delimiter}${childEnvironment.PATH ?? ''}`;
  }
}

function node(script, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env: childEnvironment, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${script} failed: ${result.status}`);
}
node('scripts/check-public-release.mjs', ...(preview ? ['--source-only'] : []));
node('scripts/prepare-public-media.mjs');
node('scripts/prepare-mediapipe-assets.mjs');
for (const helper of ['build-native-helpers', 'build-windows-capture', 'build-windows-gpu-export', 'build-cursor-monitor', 'build-whisper-runtime']) node(`scripts/${helper}.mjs`);
// Some inherited helper builders only warn on stale binaries. Do not package those silently.
for (const [helperId, directory, binaryName] of [
  ['wgc-capture', 'wgc-capture', 'wgc-capture.exe'],
  ['cursor-monitor', 'cursor-monitor', 'cursor-monitor.exe'],
  ['recordly-gpu-export', 'gpu-export-probe', 'recordly-gpu-export.exe'],
]) {
  const result = verifyNativeHelperManifest({projectRoot:root,helperId,sourceDir:path.join(root,'electron/native',directory),binaryPath:path.join(root,'electron/native/bin/win32-x64',binaryName),binaryName});
  if (!result.ok) throw new Error(formatNativeHelperManifestWarning('public-build',result));
}
node('node_modules/typescript/bin/tsc', '--noEmit');
node('node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.ts');
node('scripts/normalize-electron-main-cjs.mjs');
node('scripts/smoke-electron-main-cjs.mjs');
node('scripts/prepare-public-licenses.mjs');
const config = publicWindowsConfig(JSON5.parse(fs.readFileSync(path.join(root, 'electron-builder.json5'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
const configPath = path.join(root, '.tmp/public-windows-builder.json');
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
node('node_modules/electron-builder/out/cli/cli.js', '--config', configPath, '--win', 'dir', 'nsis', '--x64', '--publish', 'never');
node('scripts/smoke-packaged-binaries.mjs');
node('scripts/check-public-windows-package.mjs');
node('scripts/write-release-checksums.mjs', 'SHA256SUMS-windows.txt');
console.log(preview ? '本地预览安装包已生成；尚未通过公开发布验收。' : '发布候选构建完成；未上传。');
