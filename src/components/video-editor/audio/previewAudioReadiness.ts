export interface PreviewAudioReadiness {
  loading: boolean;
  error?: unknown;
  tracks: Array<Pick<HTMLMediaElement, "readyState" | "error"> | undefined>;
}

/** Check the latest render, not the track list captured before an async lookup. */
export function waitForPreviewAudio(
  snapshot: () => PreviewAudioReadiness,
  signal?: AbortSignal,
  timeoutMs = 12000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new DOMException("Playback cancelled", "AbortError"));
    const check = () => {
      if (signal?.aborted) return abort();
      const state = snapshot();
      if (!state.loading) {
        if (state.error) return finish(state.error);
        if (state.tracks.some(track => track?.error)) return finish(new Error("Audio could not be decoded"));
        if (state.tracks.every(track => track && track.readyState >= 2)) return finish();
      }
      if (Date.now() >= deadline) return finish(new Error("Audio preparation timed out"));
      timer = setTimeout(check, 50);
    };
    signal?.addEventListener("abort", abort, { once: true });
    // Allow reload / lookup state updates to commit before inspecting resources.
    timer = setTimeout(check, 0);
  });
}
