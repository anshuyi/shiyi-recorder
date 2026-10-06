import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

async function publishClosedFile(temporaryPath: string, finalPath: string) {
  try {
    await fs.link(temporaryPath, finalPath);
  } catch (error) {
    if (!["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    // exFAT and some shares cannot hard-link. The enclosing publication lock
    // serializes this recording's writers; rename stays within the same volume.
    const existing = await fs.lstat(finalPath).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) throw new Error(`Refusing to replace existing microphone file: ${finalPath}`);
    await fs.rename(temporaryPath, finalPath);
  }
}

/** Publish only a closed, validated file. Never copy bytes into the discoverable final path. */
export async function publishMicrophoneSidecar(
  finalPath: string,
  write: (temporaryWavPath: string) => Promise<void>,
  validate: (temporaryWavPath: string) => Promise<void>,
): Promise<void> {
  const temporaryPath = path.join(path.dirname(finalPath), `.mic-pending-${randomUUID()}.wav`);
  const lockPath = `${finalPath}.publish-lock`;
  await fs.mkdir(lockPath);
  let publishedMetadata = false;
  let publishedAudio = false;
  try {
    await write(temporaryPath);
    await validate(temporaryPath);
    // Metadata must be available before any consumer can discover the final WAV.
    if (await fs.stat(`${temporaryPath}.json`).then(() => true, error => {
      if (error.code === "ENOENT") return false;
      throw error;
    })) {
      await publishClosedFile(`${temporaryPath}.json`, `${finalPath}.json`);
      publishedMetadata = true;
    }
    await publishClosedFile(temporaryPath, finalPath);
    publishedAudio = true;
  } finally {
    const cleanup = [temporaryPath, `${temporaryPath}.json`];
    if (publishedMetadata && !publishedAudio) cleanup.push(`${finalPath}.json`);
    // A committed WAV remains usable even if antivirus temporarily holds a temp name.
    await Promise.all(cleanup.map(file => fs.rm(file, { force: true }).catch(error => console.warn("Microphone temporary file cleanup failed:", file, error))));
    await fs.rmdir(lockPath).catch(error => console.warn("Microphone publication lock cleanup failed:", lockPath, error));
  }
}

/** Validate the PCM16 mono 48kHz WAV produced by our FFmpeg command without reading all samples. */
export async function validatePcmWave(filePath: string): Promise<void> {
  const file = await fs.open(filePath, "r");
  try {
    const { size } = await file.stat();
    const read = async (length: number, position: number) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      if (bytesRead !== length) throw new Error("Microphone WAV is truncated");
      return buffer;
    };
    const header = await read(12, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE" || header.readUInt32LE(4) + 8 !== size) {
      throw new Error("Microphone WAV has an incomplete header");
    }
    let validFormat = false, validData = false, offset = 12;
    while (offset + 8 <= size) {
      const chunk = await read(8, offset), length = chunk.readUInt32LE(4);
      if (offset + 8 + length > size) throw new Error("Microphone WAV data is incomplete");
      const kind = chunk.toString("ascii", 0, 4);
      if (kind === "fmt " && length >= 16) {
        const fmt = await read(16, offset + 8);
        validFormat = fmt.readUInt16LE(0) === 1 && fmt.readUInt16LE(2) === 1 && fmt.readUInt32LE(4) === 48000 && fmt.readUInt32LE(8) === 96000 && fmt.readUInt16LE(12) === 2 && fmt.readUInt16LE(14) === 16;
      }
      if (kind === "data") validData = length > 0 && length % 2 === 0;
      offset += 8 + length + (length % 2);
    }
    if (!validFormat || !validData || offset !== size) throw new Error("Microphone WAV is empty or not valid PCM16 mono 48kHz");
  } finally {
    await file.close();
  }
}
