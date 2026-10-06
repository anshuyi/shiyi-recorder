import { captureRegionPixels, type CaptureRegion } from "./captureRegion";

/** Crop before MediaRecorder so files, previews and exports have identical bounds. */
export async function createRegionCaptureTrack(source: MediaStreamTrack, region: CaptureRegion, onSourceEnded?: () => void) {
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.srcObject = new MediaStream([source]);
	let timer: ReturnType<typeof setInterval> | undefined;
	let output: MediaStream | undefined;
	const cleanup = () => {
		clearInterval(timer);
		video.pause();
		video.srcObject = null;
		output?.getTracks().forEach((track) => track.stop());
		source.stop();
	};
	try {
		await Promise.race([
			video.play(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("区域录制预览加载超时")), 10000);
			}),
		]);
		clearTimeout(timer);
		const sourceWidth = video.videoWidth,
			sourceHeight = video.videoHeight;
		const rect = captureRegionPixels(region, sourceWidth, sourceHeight);
		const canvas = document.createElement("canvas");
		canvas.width = rect.width;
		canvas.height = rect.height;
		const context = canvas.getContext("2d", { alpha: false });
		if (!context) throw new Error("无法初始化区域录制");
		const draw = () => {
			// A resolution change must never broaden the selected recording area.
			if (
				source.readyState === "ended" ||
				video.videoWidth !== sourceWidth ||
				video.videoHeight !== sourceHeight
			) {
				output?.getVideoTracks().forEach((track) => track.stop());
				clearInterval(timer);
				onSourceEnded?.();
				return;
			}
			context.drawImage(
				video,
				rect.x,
				rect.y,
				rect.width,
				rect.height,
				0,
				0,
				canvas.width,
				canvas.height,
			);
		};
		draw();
		output = canvas.captureStream(60);
		timer = setInterval(draw, 1000 / 60);
		return { track: output.getVideoTracks()[0], cleanup };
	} catch (error) {
		cleanup();
		throw error;
	}
}
