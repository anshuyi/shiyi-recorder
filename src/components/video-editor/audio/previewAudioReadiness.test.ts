import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForPreviewAudio, type PreviewAudioReadiness } from "./previewAudioReadiness";

afterEach(() => vi.useRealTimers());
describe("preview audio preparation", () => {
  it("does not let playback begin while lookup or decoding is pending", async () => {
    vi.useFakeTimers();
    let state: PreviewAudioReadiness = { loading: true, tracks: [] };
    const play = vi.fn();
    const ready = waitForPreviewAudio(() => state).then(play);
    await vi.advanceTimersByTimeAsync(500);
    expect(play).not.toHaveBeenCalled();
    state = { loading: false, tracks: [undefined] };
    await vi.advanceTimersByTimeAsync(100);
    expect(play).not.toHaveBeenCalled();
    state = { loading: false, tracks: [{ readyState: 1, error: null }] };
    await vi.advanceTimersByTimeAsync(100);
    expect(play).not.toHaveBeenCalled();
    state.tracks = [{ readyState: 2, error: null }];
    await vi.advanceTimersByTimeAsync(50);
    await ready;
    expect(play).toHaveBeenCalledOnce();
  });
  it("permits a genuinely silent video after successful lookup", async () => {
    vi.useFakeTimers();
    const ready = waitForPreviewAudio(() => ({ loading: false, tracks: [] }));
    await vi.advanceTimersByTimeAsync(50);
    await expect(ready).resolves.toBeUndefined();
  });
  it.each([
    { loading: false, tracks: [], error: new Error("lookup failed") },
    { loading: false, tracks: [{ readyState: 0, error: { message: "decode failed" } }] },
  ])("rejects missing lookup or broken audio instead of silently playing", async state => {
    vi.useFakeTimers();
    const result = expect(waitForPreviewAudio(() => state)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    await result;
  });
  it("times out without hanging and allows a new attempt after recovery", async () => {
    vi.useFakeTimers();
    let state: PreviewAudioReadiness = { loading: true, tracks: [] };
    const result = expect(waitForPreviewAudio(() => state, undefined, 200)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(250);
    await result;
    state = { loading: false, tracks: [{ readyState: 4, error: null }] };
    const retry = waitForPreviewAudio(() => state);
    await vi.advanceTimersByTimeAsync(50);
    await retry;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels pending play when paused, switched or unmounted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const play = vi.fn();
    const result = expect(waitForPreviewAudio(() => ({ loading: true, tracks: [] }), controller.signal).then(play)).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(80);
    controller.abort();
    await result;
    expect(play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
