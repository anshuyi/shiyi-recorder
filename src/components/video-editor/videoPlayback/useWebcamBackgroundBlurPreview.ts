import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { WebcamBackgroundBlurProcessor } from "@/lib/webcam-effects/WebcamBackgroundBlurProcessor";
import type { CropRegion } from "../types";

const PREVIEW_EFFECT_SIZE = 512;
const PREVIEW_INFERENCE_FPS = 15;

interface WebcamBackgroundBlurPreviewOptions {
	videoRef: RefObject<HTMLVideoElement>;
	enabled: boolean;
	strength: number;
	cropRegion?: Partial<CropRegion> | null;
	aspectRatio?: number;
	sourceKey: string | null | undefined;
	onError: (error: Error) => void;
}

export function useWebcamBackgroundBlurPreview({
	videoRef,
	enabled,
	strength,
	cropRegion,
	aspectRatio = 1,
	sourceKey,
	onError,
}: WebcamBackgroundBlurPreviewOptions) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const processorRef = useRef<WebcamBackgroundBlurProcessor | null>(null);
	const processingRef = useRef(false);
	const pendingFrameRef = useRef(false);
	const generationRef = useRef(0);
	const failedRef = useRef(false);
	const enabledRef = useRef(enabled);
	const errorCallbackRef = useRef(onError);
	const optionsRef = useRef({ strength, cropRegion, aspectRatio });
	const [ready, setReady] = useState(false);

	enabledRef.current = enabled;
	errorCallbackRef.current = onError;
	optionsRef.current = { strength, cropRegion, aspectRatio };

	const renderCurrentFrame = useCallback(async () => {
		if (!enabledRef.current || failedRef.current) return;
		const video = videoRef.current;
		if (
			!video ||
			video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
			video.videoWidth <= 0 ||
			video.videoHeight <= 0
		) {
			return;
		}

		if (processingRef.current) {
			pendingFrameRef.current = true;
			return;
		}

		processingRef.current = true;
		const generation = generationRef.current;
		try {
			let processor = processorRef.current;
			if (!processor) {
				processor = new WebcamBackgroundBlurProcessor();
				processorRef.current = processor;
			}
			const output = await processor.process({
				source: video,
				sourceWidth: video.videoWidth,
				sourceHeight: video.videoHeight,
				cropRegion: optionsRef.current.cropRegion,
				aspectRatio: optionsRef.current.aspectRatio,
				sourceTimeMs: Math.max(0, video.currentTime * 1000),
				strength: optionsRef.current.strength,
				targetSize: PREVIEW_EFFECT_SIZE,
				inferenceFps: PREVIEW_INFERENCE_FPS,
			});
			if (generation !== generationRef.current) return;

			const canvas = canvasRef.current;
			const context = canvas?.getContext("2d");
			if (!canvas || !context)
				throw new Error("Unable to draw webcam background blur preview");
			if (canvas.width !== output.width || canvas.height !== output.height) {
				canvas.width = output.width;
				canvas.height = output.height;
				context.imageSmoothingEnabled = true;
				context.imageSmoothingQuality = "high";
			}
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(output, 0, 0);
			setReady(true);
		} catch (error) {
			if (generation !== generationRef.current || failedRef.current) return;
			failedRef.current = true;
			processorRef.current?.dispose();
			processorRef.current = null;
			setReady(false);
			errorCallbackRef.current(error instanceof Error ? error : new Error(String(error)));
		} finally {
			processingRef.current = false;
			if (pendingFrameRef.current) {
				pendingFrameRef.current = false;
				queueMicrotask(() => void renderCurrentFrame());
			}
		}
	}, [videoRef]);

	useEffect(() => {
		generationRef.current++;
		failedRef.current = false;
		pendingFrameRef.current = false;
		setReady(false);
		processorRef.current?.dispose();
		processorRef.current = null;
		if (!enabled || !sourceKey) return;

		return () => {
			generationRef.current++;
			processorRef.current?.dispose();
			processorRef.current = null;
		};
	}, [enabled, sourceKey]);

	useEffect(() => {
		if (!enabled) return;
		const video = videoRef.current;
		if (!video) return;

		let cancelled = false;
		let animationFrameId: number | null = null;
		let videoFrameId: number | null = null;
		const frameVideo = video as HTMLVideoElement & {
			requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
			cancelVideoFrameCallback?: (handle: number) => void;
		};
		const requestNextFrame = () => {
			if (cancelled || animationFrameId !== null || videoFrameId !== null) return;
			if (typeof frameVideo.requestVideoFrameCallback === "function") {
				videoFrameId = frameVideo.requestVideoFrameCallback(() => {
					videoFrameId = null;
					void renderCurrentFrame();
					requestNextFrame();
				});
				return;
			}
			if (video.paused) return;
			animationFrameId = requestAnimationFrame(() => {
				animationFrameId = null;
				void renderCurrentFrame();
				requestNextFrame();
			});
		};
		const refresh = () => void renderCurrentFrame();
		const handlePlaying = () => {
			refresh();
			requestNextFrame();
		};

		video.addEventListener("loadeddata", refresh);
		video.addEventListener("seeked", refresh);
		video.addEventListener("playing", handlePlaying);
		void renderCurrentFrame();
		if (!video.paused || typeof frameVideo.requestVideoFrameCallback === "function") {
			requestNextFrame();
		}

		return () => {
			cancelled = true;
			video.removeEventListener("loadeddata", refresh);
			video.removeEventListener("seeked", refresh);
			video.removeEventListener("playing", handlePlaying);
			if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
			if (
				videoFrameId !== null &&
				typeof frameVideo.cancelVideoFrameCallback === "function"
			) {
				frameVideo.cancelVideoFrameCallback(videoFrameId);
			}
		};
	}, [enabled, renderCurrentFrame, videoRef]);

	useEffect(() => {
		optionsRef.current = { strength, cropRegion, aspectRatio };
		if (enabled) void renderCurrentFrame();
	}, [cropRegion, aspectRatio, enabled, renderCurrentFrame, strength]);

	return { canvasRef, ready };
}
