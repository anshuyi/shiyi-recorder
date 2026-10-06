import { afterEach, describe, expect, it, vi } from "vitest";
import { pendingOperation } from "./pendingOperation";
afterEach(()=>vi.useRealTimers());
describe('pending operation cleanup',()=>{
	it('disposes late devices after timeout',async()=>{
		vi.useFakeTimers();let resolve!: (s:string)=>void;const dispose=vi.fn();
		const result=pendingOperation(new Promise<string>(r=>resolve=r),{timeoutMs:100,disposeLate:dispose});
		const check=expect(result).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(100);await check;resolve('late');await Promise.resolve();expect(dispose).toHaveBeenCalledWith('late');
	});
	it('cancels without letting a late result replace a new operation',async()=>{
		const controller=new AbortController();let resolve!: (s:string)=>void;const dispose=vi.fn();const a=pendingOperation(new Promise<string>(r=>resolve=r),{signal:controller.signal,disposeLate:dispose});
		controller.abort();await expect(a).rejects.toMatchObject({name:'AbortError'});expect(await pendingOperation(Promise.resolve('new'))).toBe('new');resolve('old');await Promise.resolve();expect(dispose).toHaveBeenCalledWith('old');
	});
	it('clears timers after success and propagates rejection',async()=>{
		vi.useFakeTimers();expect(await pendingOperation(Promise.resolve(3),{timeoutMs:100})).toBe(3);expect(vi.getTimerCount()).toBe(0);
		await expect(pendingOperation(Promise.reject(Error('denied')))).rejects.toThrow('denied');
	});
	it('cleans a value arriving after an already aborted signal',async()=>{
		const c=new AbortController();c.abort();const dispose=vi.fn();await expect(pendingOperation(Promise.resolve(1),{signal:c.signal,disposeLate:dispose})).rejects.toMatchObject({name:'AbortError'});expect(dispose).toHaveBeenCalledWith(1);
	});
});
