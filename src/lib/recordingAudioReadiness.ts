export function requireLiveMicrophone(stream: MediaStream) {
	const track = stream.getAudioTracks()[0];
	if (!track || track.readyState !== "live" || !track.enabled) throw new Error("麦克风没有可用音轨");
	return track;
}

/** Attach before start so even a synchronous start failure releases every listener. */
export function startRecorderWithAudio(recorder: MediaRecorder, microphone: MediaStream, signal?: AbortSignal, timeoutMs = 8000): Promise<void> {
	return new Promise((resolve, reject) => {
		let track: MediaStreamTrack;
		try { track = requireLiveMicrophone(microphone); } catch (error) { reject(error); return; }
		const finish = (error?: Error) => {
			clearTimeout(timer);
			recorder.removeEventListener("dataavailable", data);
			recorder.removeEventListener("error", failed);
			recorder.removeEventListener("stop", stopped);
			track.removeEventListener("ended", failed);
			signal?.removeEventListener("abort", aborted);
			error ? reject(error) : resolve();
		};
		const data = (event: BlobEvent) => { if (event.data.size > 0) finish(); };
		const failed = () => finish(new Error("麦克风采集失败，请检查设备连接和权限"));
		const stopped = () => finish(new Error("声音录制器在准备完成前已停止"));
		const aborted = () => finish(new DOMException("操作已取消", "AbortError"));
		const timer = setTimeout(() => finish(new Error("麦克风启动超时，尚未收到声音数据")), timeoutMs);
		recorder.addEventListener("dataavailable", data);
		recorder.addEventListener("error", failed);
		recorder.addEventListener("stop", stopped);
		track.addEventListener("ended", failed);
		signal?.addEventListener("abort", aborted, { once: true });
		if (signal?.aborted) { aborted(); return; }
		try { recorder.start(250); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
	});
}

/** Silence still produces chunks. Pauses and resume get a fresh grace period. */
export function monitorRecordingAudio(recorder: MediaRecorder, microphone: MediaStream, onFault: (reason: string) => void, timeoutMs = 15000) {
	const track = requireLiveMicrophone(microphone);
	let lastData = performance.now();
	let done = false;
	const reset = () => { lastData = performance.now(); };
	const data = (event: BlobEvent) => { if (event.data.size > 0) reset(); };
	const fault = (reason: string) => { if (!done) { dispose(); onFault(reason); } };
	const ended = () => fault("麦克风已断开");
	const failed = () => fault("声音录制器发生错误");
	const stopped = () => fault("声音录制器意外停止");
	const timer = setInterval(() => {
		if (recorder.state === "paused") reset();
		else if (recorder.state === "recording" && performance.now() - lastData > timeoutMs) fault("长时间未收到声音数据");
	}, 1000);
	function dispose() {
		done = true; clearInterval(timer);
		recorder.removeEventListener("dataavailable", data);
		recorder.removeEventListener("error", failed);
		recorder.removeEventListener("stop", stopped);
		recorder.removeEventListener("resume", reset);
		track.removeEventListener("ended", ended);
	}
	recorder.addEventListener("dataavailable", data);
	recorder.addEventListener("error", failed);
	recorder.addEventListener("stop", stopped);
	recorder.addEventListener("resume", reset);
	track.addEventListener("ended", ended);
	return dispose;
}
