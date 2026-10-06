type MediaResource = { src: string; revoke: () => void };
type Callbacks = { onLoaded: () => void; onError: (error: unknown) => void };
type Entry = {
  path: string;
  revision: number;
  audio: HTMLAudioElement;
  state: "loading" | "ready" | "failed";
  revoke?: () => void;
  removeListeners?: () => void;
};

let resourceSequence = 0;
const resourceSession = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function freshLocalUrl(src: string) {
  try {
    const url = new URL(src);
    if (url.protocol === "file:" || ((url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/video")) {
      url.searchParams.set("audioRevision", `${resourceSession}-${++resourceSequence}`);
      return url.href;
    }
  } catch { /* Blob, relative and external resources retain their existing handling. */ }
  return src;
}

/** Requests belong to a track instance, not to an individual React render. */
export class PreviewAudioResources {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly resolve: (path: string) => Promise<MediaResource>) {}

  load(id: string, audio: HTMLAudioElement, path: string, callbacks: Callbacks, revision = 0) {
    const existing = this.entries.get(id);
    if (existing?.audio === audio && existing.path === path && existing.revision === revision) return;
    this.release(id);
    const entry: Entry = { path, audio, revision, state: "loading" };
    this.entries.set(id, entry);
    void this.loadEntry(id, entry, callbacks);
  }

  private async loadEntry(id: string, entry: Entry, callbacks: Callbacks) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resource = await this.resolve(entry.path);
        if (this.entries.get(id) !== entry) {
          resource.revoke();
          return;
        }
        entry.revoke = resource.revoke;
        const ready = () => { if (this.entries.get(id) === entry) callbacks.onLoaded(); };
        entry.audio.addEventListener?.("loadedmetadata", ready);
        entry.audio.addEventListener?.("loadeddata", ready);
        entry.removeListeners = () => {
          entry.audio.removeEventListener?.("loadedmetadata", ready);
          entry.audio.removeEventListener?.("loadeddata", ready);
        };
        entry.audio.src = freshLocalUrl(resource.src);
        entry.audio.load();
        entry.state = "ready";
      } catch (error) {
        if (this.entries.get(id) !== entry) return;
        entry.audio.src = "";
        entry.removeListeners?.();
        entry.revoke?.();
        entry.revoke = undefined;
        if (attempt === 0) continue;
        entry.state = "failed";
        callbacks.onError(error);
        return;
      }
      callbacks.onLoaded();
      return;
    }
  }

  retryFailed() {
    for (const [id, entry] of this.entries) {
      if (entry.state === "failed" || entry.audio.error) this.release(id);
    }
  }

  release(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.removeListeners?.();
    entry.audio.pause();
    entry.audio.src = "";
    entry.revoke?.();
  }

  clear() {
    for (const id of this.entries.keys()) this.release(id);
  }
}
