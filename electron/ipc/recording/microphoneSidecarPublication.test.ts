import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishMicrophoneSidecar, validatePcmWave } from "./microphoneSidecarPublication";

const dirs: string[] = [];
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-音频 "));
  dirs.push(dir);
  return { dir, target: path.join(dir, "recording.mic.wav") };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function wave() {
  const b = Buffer.alloc(48);
  b.write("RIFF"); b.writeUInt32LE(40, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(4, 40); b.writeInt16LE(1234, 44);
  return b;
}
describe("microphone publication", () => {
  it("publishes safely on filesystems without hard links", async () => {
    vi.spyOn(fs, "link").mockRejectedValue(Object.assign(Error("not supported"), {code:"ENOTSUP"}));
    const { target, dir } = await fixture();
    const results = await Promise.allSettled([1,2].map(() => publishMicrophoneSidecar(target, temp => fs.writeFile(temp, wave()), validatePcmWave)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await fs.readFile(target)).toEqual(wave());
    expect(await fs.readdir(dir)).toEqual(["recording.mic.wav"]);
    await expect(publishMicrophoneSidecar(target, temp => fs.writeFile(temp, "new"), async()=>{})).rejects.toThrow();
    expect(await fs.readFile(target)).toEqual(wave());
  });
  it("cleanup failure after successful publication does not report saved audio as lost", async () => {
    const { target } = await fixture();
    vi.spyOn(fs, "rm").mockRejectedValue(Object.assign(Error("busy"), {code:"EPERM"}));
    await expect(publishMicrophoneSidecar(target, temp => fs.writeFile(temp, wave()), validatePcmWave)).resolves.toBeUndefined();
    expect(await fs.readFile(target)).toEqual(wave());
  });
  it("publishes timing metadata together with validated audio", async () => {
    const { target, dir } = await fixture();
    await publishMicrophoneSidecar(target, async temp => {
      await fs.writeFile(temp, wave());
      await fs.writeFile(`${temp}.json`, '{"startDelayMs":418}');
    }, validatePcmWave);
    expect(JSON.parse(await fs.readFile(`${target}.json`, "utf8"))).toEqual({ startDelayMs: 418 });
    expect((await fs.readdir(dir)).sort()).toEqual(["recording.mic.wav", "recording.mic.wav.json"]);
  });
  it("hides incomplete audio until writing and validation finish", async () => {
    const { dir, target } = await fixture(), written = gate(), finish = gate(), validated = gate(), publish = gate();
    const job = publishMicrophoneSidecar(target, async temp => {
      expect(path.dirname(temp)).toBe(dir);
      expect(temp).not.toBe(target);
      await fs.writeFile(temp, wave().subarray(0, 44)); written.resolve();
      await finish.promise; await fs.writeFile(temp, wave());
    }, async temp => { await validatePcmWave(temp); validated.resolve(); await publish.promise; });
    await written.promise;
    expect(await fs.stat(target).catch(() => null)).toBeNull();
    finish.resolve(); await validated.promise;
    expect(await fs.stat(target).catch(() => null)).toBeNull();
    publish.resolve(); await job;
    expect(await fs.readFile(target)).toEqual(wave());
    expect(await fs.readdir(dir)).toEqual(["recording.mic.wav"]);
  });
  it.each(["write", "validate"])("cleans only its temp file after %s failure", async phase => {
    const { dir, target } = await fixture();
    await expect(publishMicrophoneSidecar(target, async temp => {
      await fs.writeFile(temp, wave()); if (phase === "write") throw Error("write failed");
    }, async () => { throw Error("validate failed"); })).rejects.toThrow("failed");
    expect(await fs.readdir(dir)).toEqual([]);
  });
  it("never replaces an existing complete recording", async () => {
    const { target } = await fixture(); await fs.writeFile(target, "original");
    await expect(publishMicrophoneSidecar(target, temp => fs.writeFile(temp, wave()), validatePcmWave)).rejects.toThrow();
    expect(await fs.readFile(target, "utf8")).toBe("original");
  });
  it("two publishers cannot overwrite each other", async () => {
    const { target, dir } = await fixture();
    const results = await Promise.allSettled([1, 2].map(() => publishMicrophoneSidecar(target, temp => fs.writeFile(temp, wave()), validatePcmWave)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await fs.readFile(target)).toEqual(wave());
    expect(await fs.readdir(dir)).toHaveLength(1);
  });
  it.each(["truncated", "growing", "invalid-format", "empty"])("rejects %s WAV before publication", async kind => {
    const { target } = await fixture(); let b = wave();
    if (kind === "truncated") b = b.subarray(0, 46);
    if (kind === "growing") b.writeUInt32LE(0xffffffff, 40);
    if (kind === "invalid-format") b.writeUInt16LE(3, 20);
    if (kind === "empty") { b = b.subarray(0, 44); b.writeUInt32LE(36, 4); b.writeUInt32LE(0, 40); }
    await expect(publishMicrophoneSidecar(target, temp => fs.writeFile(temp, b), validatePcmWave)).rejects.toThrow();
    expect(await fs.stat(target).catch(() => null)).toBeNull();
  });
});
