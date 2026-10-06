import { describe, it, expect, vi, afterEach } from "vitest";
import { createMonitorResolver, parseMonitorHandles } from "./monitorResolver";
const monitor = {handle: 123, x: -1920, y: 0, width: 1920, height: 1080};
afterEach(() => vi.useRealTimers());
describe("asynchronous monitor lookup", () => {
	it("merges concurrent lookups and caches successful results", async () => {
		const query=vi.fn(async()=>[monitor]); const r=createMonitorResolver(query);
		const a=r.get(), b=r.get(); expect(a).toBe(b); expect(await a).toEqual([monitor]);
		await r.get(); expect(query).toHaveBeenCalledTimes(1);
	});
	it("expires and invalidates cached results", async () => {
		vi.useFakeTimers();const q=vi.fn(async()=>[monitor]);const r=createMonitorResolver(q,100);
		await r.get();await vi.advanceTimersByTimeAsync(101);await r.get();r.invalidate();await r.get();expect(q).toHaveBeenCalledTimes(3);
	});
	it("retries failed or empty lookups", async () => {
		const q=vi.fn().mockRejectedValueOnce(Error('device')).mockResolvedValueOnce([]).mockResolvedValue([monitor]);const r=createMonitorResolver(q);
		expect(await r.get()).toEqual([]);expect(await r.get()).toEqual([]);expect(await r.get()).toEqual([monitor]);
	});
	it("discards stale results after topology changes without clearing newer requests", async () => {
		let old!: (v: typeof monitor[])=>void;const q=vi.fn().mockImplementationOnce(()=>new Promise(r=>old=r)).mockResolvedValue([monitor]);const r=createMonitorResolver(q);
		const a=r.get();await Promise.resolve();r.invalidate();const b=r.get();old([{...monitor,width:999}]);
		expect(await a).toEqual([]);expect(await b).toEqual([monitor]);expect(await r.get()).toEqual([monitor]);
	});
	it("keeps the event loop responsive while lookup waits", async () => {
		vi.useFakeTimers();const r=createMonitorResolver(()=>new Promise(resolve=>setTimeout(()=>resolve([monitor]),5000)));
		const lookup=r.get();let ticks=0;const t=setInterval(()=>ticks++,10);await vi.advanceTimersByTimeAsync(5000);clearInterval(t);
		expect(ticks).toBe(500);expect(await lookup).toEqual([monitor]);
	});
	it("rejects malformed monitor output but accepts negative desktop origins",()=>{
		expect(parseMonitorHandles('123|-1920|0|1920|1080\r\nbad\n4|0|0|NaN|100\n5|0|0|0|1')).toEqual([monitor]);
	});
});
