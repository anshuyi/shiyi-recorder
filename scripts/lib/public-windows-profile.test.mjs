import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWindowsEnvironment, publicWindowsConfig } from './public-windows-profile.mjs';
import * as profile from './public-windows-profile.mjs';

test('Windows toolchains receive one variable per case-insensitive name', () => {
  const input = { PATH: 'toolchain', Path: 'legacy', HOME: 'unchanged' };
  const result = normalizeWindowsEnvironment(input);
  assert.equal(Object.keys(result).filter(key => key.toLowerCase() === 'path').length, 1);
  assert.equal(result.PATH, 'toolchain');
  assert.equal(result.HOME, 'unchanged');
  assert.equal(input.Path, 'legacy');
});

test('Windows x64 whisper workaround removes unused generic assembler discovery, reproducibly', () => {
  assert.equal(typeof profile.patchWindowsGgml, 'function');
  const original = 'cmake_minimum_required(VERSION 3.14)\nproject("ggml" C CXX ASM)\n';
  const patched = profile.patchWindowsGgml(original);
  assert.ok(patched.includes('project("ggml" C CXX)'));
  assert.equal(profile.patchWindowsGgml(patched), patched);
  assert.throws(() => profile.patchWindowsGgml('different upstream project'), /unexpected/i);
});

test('whisper diagnostics use relative filenames without changing original line numbers', () => {
  assert.equal(typeof profile.sanitizeWhisperSourcePath, 'function');
  const original = '#include <stdio.h>\n';
  const patched = profile.sanitizeWhisperSourcePath(original, 'src/whisper.cpp');
  assert.ok(patched.endsWith('#line 1 "src/whisper.cpp"\n' + original));
  assert.equal(profile.sanitizeWhisperSourcePath(patched, 'src/whisper.cpp'), patched);
  assert.throws(() => profile.sanitizeWhisperSourcePath(original, '../private.cpp'), /relative/i);
  assert.throws(() => profile.sanitizeWhisperSourcePath(original, 'C:/private.cpp'), /relative/i);
});

test('public Windows package includes only authorized wallpaper and target binaries', () => {
  const result = publicWindowsConfig({ files: ['dist', 'electron/native'], extraResources: [{ from: 'public/wallpapers', to: 'assets/wallpapers' }], win: {} }, '0.1.0-beta.1');
  assert.ok(result.files.includes('!dist/wallpapers/**'));
  assert.ok(result.files.includes('!electron/native/bin/win32-x64/recordly-nvidia-cuda-compositor.exe'));
  assert.ok(result.files.includes('electron/native/bin/win32-x64/**'));
  assert.ok(!result.files.includes('electron/native'));
  assert.deepEqual(result.extraResources[0].filter, ['paper-collage.png']);
  assert.equal(result.win.artifactName, 'Shiyi-Recorder-0.1.0-beta.1-windows-x64-Setup.${ext}');
  assert.equal(result.publish, null);
  assert.equal(result.nsis.deleteAppDataOnUninstall, false);
});
