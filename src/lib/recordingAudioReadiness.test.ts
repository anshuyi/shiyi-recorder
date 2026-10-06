import { afterEach, describe, expect, it, vi } from "vitest";
import { monitorRecordingAudio, startRecorderWithAudio } from "./recordingAudioReadiness";
function fixture() {
	const track = Object.assign(new EventTarget(), { readyState: "live", enabled: true });
	const mic = { getAudioTracks: () => [track] } as unknown as MediaStream;
	const r = Object.assign(new EventTarget(), { state: "inactive", start: vi.fn(() => { r.state = "recording"; }) });
	const recorder = r as unknown as MediaRecorder;
	const chunk = (size = 2) => r.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob([new Uint8Array(size)]) }));
	return { track, mic, r, recorder, chunk };
}
afterEach(() => vi.useRealTimers());
describe("audio startup readiness", () => {
	it("waits for data without swallowing the chunk", async () => { const f = fixture(); const sink = vi.fn(); f.r.addEventListener("dataavailable", sink); const p = startRecorderWithAudio(f.recorder, f.mic); f.chunk(); await p; expect(sink).toHaveBeenCalledOnce(); });
	it("empty data cannot declare ready", async () => { vi.useFakeTimers(); const f = fixture(); const p = startRecorderWithAudio(f.recorder, f.mic); const assertion = expect(p).rejects.toThrow("超时"); f.chunk(0); await vi.advanceTimersByTimeAsync(8000); await assertion; });
	it("rejects an ended track", async () => { const f = fixture(); f.track.readyState = "ended"; await expect(startRecorderWithAudio(f.recorder, f.mic)).rejects.toThrow("音轨"); expect(f.r.start).not.toHaveBeenCalled(); });
	it("honors cancellation", async () => { const f = fixture(); const c = new AbortController(); const p = startRecorderWithAudio(f.recorder, f.mic, c.signal); c.abort(); await expect(p).rejects.toThrow("取消"); });
	it("propagates start exceptions", async () => { const f = fixture(); f.r.start.mockImplementation(() => { throw Error("broken"); }); await expect(startRecorderWithAudio(f.recorder, f.mic)).rejects.toThrow("broken"); });
	it("rejects recorder errors", async () => { const f = fixture(); const p = startRecorderWithAudio(f.recorder, f.mic); f.r.dispatchEvent(new Event("error")); await expect(p).rejects.toThrow("采集失败"); });
});
describe("recording audio monitor", () => {
	it("stops once on disconnection and detaches", () => { const f = fixture(); const fault = vi.fn(); monitorRecordingAudio(f.recorder, f.mic, fault); f.track.dispatchEvent(new Event("ended")); f.r.dispatchEvent(new Event("error")); expect(fault).toHaveBeenCalledOnce(); });
	it("ignores natural silence with chunks and normal pauses", async () => { vi.useFakeTimers(); const f = fixture(); f.r.state = "recording"; const fault = vi.fn(); const dispose = monitorRecordingAudio(f.recorder, f.mic, fault); for (let i = 0; i < 20; i++) { f.chunk(); await vi.advanceTimersByTimeAsync(1000); } f.r.state = "paused"; await vi.advanceTimersByTimeAsync(20000); f.r.state = "recording"; f.r.dispatchEvent(new Event("resume")); await vi.advanceTimersByTimeAsync(1000); expect(fault).not.toHaveBeenCalled(); dispose(); });
	it("detects data starvation but not an intentional stop", async () => { vi.useFakeTimers(); const f = fixture(); f.r.state = "recording"; const fault = vi.fn(); const dispose = monitorRecordingAudio(f.recorder, f.mic, fault); await vi.advanceTimersByTimeAsync(16000); expect(fault).toHaveBeenCalledOnce(); dispose(); f.r.dispatchEvent(new Event("stop")); expect(fault).toHaveBeenCalledOnce(); });
});
