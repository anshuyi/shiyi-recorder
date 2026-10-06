import { describe, expect, it, vi } from "vitest";
import { PreviewAudioResources } from "./previewAudioResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function audio() {
  return { src: "", pause: vi.fn(), load: vi.fn() } as unknown as HTMLAudioElement;
}
const resource = (src: string) => ({ src, revoke: vi.fn() });
const callbacks = () => ({ onLoaded: vi.fn(), onError: vi.fn() });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("PreviewAudioResources", () => {
  it("reloads a completed same-path resource on a new revision", async () => {
    const resolve = vi.fn().mockResolvedValue(resource("http://localhost:9876/video?path=C%3A%2F%E6%9D%9C%20a.mic.wav"));
    const loader = new PreviewAudioResources(resolve), element = audio(), cb = callbacks();
    loader.load("mic", element, "C:/杜 a.mic.wav", cb, 0); await flush();
    const first = element.src;
    loader.load("mic", element, "C:/杜 a.mic.wav", cb, 1); await flush();
    expect(element.src).not.toBe(first);
    expect(new URL(element.src).searchParams.get("path")).toBe("C:/杜 a.mic.wav");
    expect(resolve).toHaveBeenCalledTimes(2);
    loader.load("mic", element, "C:/杜 a.mic.wav", cb, 1); await flush();
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("a released ready local resource gets a fresh URL when explicitly reloaded", async () => {
    const loader = new PreviewAudioResources(async () => resource("file:///C:/audio.wav")), element = audio(), cb = callbacks();
    loader.load("mic", element, "C:/audio.wav", cb); await flush(); const first = element.src;
    loader.release("mic"); loader.load("mic", element, "C:/audio.wav", cb); await flush();
    expect(element.src).not.toBe(first);
  });
  it("shares pending loads across ordinary renders", async () => {
    const pending = deferred<ReturnType<typeof resource>>();
    const resolve = vi.fn(() => pending.promise);
    const loader = new PreviewAudioResources(resolve);
    const element = audio(), cb = callbacks();
    loader.load("mic", element, "mic.wav", cb);
    loader.load("mic", element, "mic.wav", cb);
    const result = resource("blob:mic"); pending.resolve(result); await flush();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(element.src).toBe("blob:mic");
    expect(cb.onLoaded).toHaveBeenCalledTimes(1);
    expect(result.revoke).not.toHaveBeenCalled();
  });

  it("discards stale requests even after the same path is restored", async () => {
    const requests = [deferred<ReturnType<typeof resource>>(), deferred<ReturnType<typeof resource>>(), deferred<ReturnType<typeof resource>>()];
    let i = 0; const loader = new PreviewAudioResources(() => requests[i++].promise);
    const element = audio(), cb = callbacks();
    loader.load("track", element, "a.wav", cb);
    loader.load("track", element, "b.wav", cb);
    loader.load("track", element, "a.wav", cb);
    const stale = resource("blob:old-a"), middle = resource("blob:b"), current = resource("blob:new-a");
    requests[2].resolve(current); await flush();
    requests[0].resolve(stale); requests[1].resolve(middle); await flush();
    expect(element.src).toBe("blob:new-a");
    expect(stale.revoke).toHaveBeenCalledOnce(); expect(middle.revoke).toHaveBeenCalledOnce();
    expect(cb.onLoaded).toHaveBeenCalledTimes(1);
  });

  it("releases late results after removal and permits a fresh mount", async () => {
    const pending = deferred<ReturnType<typeof resource>>();
    const next = resource("blob:next");
    const resolve = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(next);
    const loader = new PreviewAudioResources(resolve), cb = callbacks();
    const old = audio(); loader.load("mic", old, "mic.wav", cb); loader.clear();
    const fresh = audio(); loader.load("mic", fresh, "mic.wav", cb); await flush();
    const stale = resource("blob:old"); pending.resolve(stale); await flush();
    expect(old.src).toBe(""); expect(fresh.src).toBe("blob:next");
    expect(stale.revoke).toHaveBeenCalledOnce();
    loader.clear(); loader.clear(); expect(next.revoke).toHaveBeenCalledOnce();
  });

  it("retries once automatically and stops repeated-render retry loops", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("unavailable"));
    const loader = new PreviewAudioResources(resolve), element = audio(), cb = callbacks();
    loader.load("mic", element, "mic.wav", cb); await flush();
    for (let i = 0; i < 20; i++) loader.load("mic", element, "mic.wav", cb);
    await flush(); expect(resolve).toHaveBeenCalledTimes(2); expect(cb.onError).toHaveBeenCalledOnce();
    expect(element.src).toBe("");
    resolve.mockResolvedValue(resource("blob:recovered"));
    loader.retryFailed(); loader.load("mic", element, "mic.wav", cb); await flush();
    expect(element.src).toBe("blob:recovered"); expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("recovers a transient error without reporting failure", async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(resource("blob:ready"));
    const loader = new PreviewAudioResources(resolve), element = audio(), cb = callbacks();
    loader.load("mic", element, "mic.wav", cb); await flush();
    expect(element.src).toBe("blob:ready"); expect(cb.onError).not.toHaveBeenCalled();
  });

  it("does not retry or report rejected requests after removal", async () => {
    const pending = deferred<ReturnType<typeof resource>>(), cb = callbacks();
    const resolve = vi.fn(() => pending.promise), loader = new PreviewAudioResources(resolve);
    loader.load("mic", audio(), "mic.wav", cb); loader.release("mic");
    pending.reject(new Error("late failure")); await flush();
    expect(resolve).toHaveBeenCalledOnce(); expect(cb.onError).not.toHaveBeenCalled();
  });
});
