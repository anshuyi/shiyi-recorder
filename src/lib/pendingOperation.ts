/** Bounds an operation without letting a late result retain devices or mutate new state. */
export function pendingOperation<T>(promise: Promise<T>, options: {
	timeoutMs?: number; signal?: AbortSignal; disposeLate?: (value: T) => void; message?: string;
} = {}): Promise<T> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
		const fail = (error: Error) => { if (!settled) { settled = true; cleanup(); reject(error); } };
		const abort = () => fail(new DOMException("操作已取消", "AbortError"));
		promise.then(value => {
			if (settled) { options.disposeLate?.(value); return; }
			settled = true; cleanup(); resolve(value);
		}, error => fail(error)).catch(() => undefined);
		if (options.signal?.aborted) { abort(); return; }
		options.signal?.addEventListener("abort", abort, {once:true});
		if (options.timeoutMs) timer = setTimeout(() => fail(new Error(options.message || "操作等待超时，请重试")), options.timeoutMs);
	});
}

export const stopMediaStream = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());
