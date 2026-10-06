// MSBuild treats environment names case-insensitively and rejects PATH + Path.
export function normalizeWindowsEnvironment(environment) {
  const result = {}, seen = new Set();
  for (const [key, value] of Object.entries(environment)) {
    const normalized = key.toUpperCase();
    if (!seen.has(normalized)) { result[normalized] = value; seen.add(normalized); }
  }
  return result;
}

// The CPU-only Windows x64 target has no .S inputs. Avoid CMake's generic
// assembler search, which crashes on this Windows toolchain (0xC0000409).
export function patchWindowsGgml(source) {
  const original = 'project("ggml" C CXX ASM)';
  const replacement = '# Shiyi Windows x64 CPU build: no generic assembler inputs.\nproject("ggml" C CXX)';
  if (source.includes(replacement)) return source;
  if (!source.includes(original)) throw new Error('Unexpected upstream ggml CMake project declaration');
  return source.replace(original, replacement);
}

// MSVC has no supported file-prefix-map switch. #line preserves original
// line numbers while making __FILE__ diagnostics independent of the builder.
export function sanitizeWhisperSourcePath(source, relativePath) {
  if (!/^[A-Za-z0-9_./-]+$/.test(relativePath) || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    throw new Error('Whisper source filename must be a safe relative path');
  }
  const prefix = `// Shiyi: reproducible diagnostic filename.\n#line 1 ${JSON.stringify(relativePath)}\n`;
  return source.startsWith(prefix) ? source : prefix + source;
}

// Keep this publication profile separate from local development packaging.
export function publicWindowsConfig(config, version) {
  const result = structuredClone(config);
  // uiohook-napi uses its versioned Windows Node-API prebuild. Rebuilding it
  // introduces an unnecessary external VC runtime dependency.
  result.npmRebuild = false;
  result.buildDependenciesFromSource = false;
  result.files = result.files.filter(file => file !== 'electron/native');
  result.files.push('!dist/wallpapers/**', 'electron/native/bin/win32-x64/**',
    '!electron/native/bin/win32-x64/recordly-nvidia-cuda-compositor.exe');
  result.extraResources = result.extraResources.map(resource => resource.from === 'public/wallpapers'
    ? { ...resource, filter: ['paper-collage.png'] } : resource);
  result.extraResources.push({ from: 'build/licenses', to: 'licenses/third-party' });
  result.win.artifactName = `Shiyi-Recorder-${version}-windows-x64-Setup.\${ext}`;
  result.win.signAndEditExecutable = false;
  result.nsis = { ...result.nsis, oneClick: false, perMachine: false,
    allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false,
    runAfterFinish: false, createDesktopShortcut: true, createStartMenuShortcut: true };
  result.publish = null;
  return result;
}
