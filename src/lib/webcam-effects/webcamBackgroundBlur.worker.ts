/// <reference lib="webworker" />

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import {
	getWebcamBackgroundBlurRadius,
	processPersonConfidenceMask,
	shouldResetPersonMask,
} from "./maskProcessing";
import type {
	WebcamEffectProcessRequest,
	WebcamEffectWorkerRequest,
	WebcamEffectWorkerResponse,
} from "./protocol";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

let segmenter: ImageSegmenter | null = null;
let personMaskIndex = 1;
let previousTemporalMask: Float32Array | null = null;
let cachedAlphaMask: Float32Array | null = null;
let cachedMaskWidth = 0;
let cachedMaskHeight = 0;
let cachedMaskVersion = 0;
let uploadedMaskVersion = -1;
let previousSourceTimeMs: number | null = null;
let previousStreamKey: string | null = null;
let lastInferenceSourceTimeMs: number | null = null;
let inferenceTimestampMs = 0;

let outputCanvas: OffscreenCanvas | null = null;
let outputContext: OffscreenCanvasRenderingContext2D | null = null;
let foregroundCanvas: OffscreenCanvas | null = null;
let foregroundContext: OffscreenCanvasRenderingContext2D | null = null;
let modelMaskCanvas: OffscreenCanvas | null = null;
let modelMaskContext: OffscreenCanvasRenderingContext2D | null = null;
let scaledMaskCanvas: OffscreenCanvas | null = null;
let scaledMaskContext: OffscreenCanvasRenderingContext2D | null = null;

function postMessage(response: WebcamEffectWorkerResponse, transfer: Transferable[] = []): void {
	workerScope.postMessage(response, transfer);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function resetTemporalState(): void {
	previousTemporalMask = null;
	cachedAlphaMask = null;
	cachedMaskWidth = 0;
	cachedMaskHeight = 0;
	cachedMaskVersion++;
	lastInferenceSourceTimeMs = null;
}

function ensureCanvas(
	currentCanvas: OffscreenCanvas | null,
	currentContext: OffscreenCanvasRenderingContext2D | null,
	width: number,
	height: number,
): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
	if (
		currentCanvas &&
		currentContext &&
		currentCanvas.width === width &&
		currentCanvas.height === height
	) {
		return [currentCanvas, currentContext];
	}

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Unable to create webcam effect canvas");
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	return [canvas, context];
}

function refreshPersonMask(frame: ImageBitmap): void {
	if (!segmenter) throw new Error("Webcam background blur is not initialized");

	inferenceTimestampMs = Math.max(inferenceTimestampMs + 1, Math.round(performance.now()));
	segmenter.segmentForVideo(frame, inferenceTimestampMs, (result) => {
		const masks = result.confidenceMasks ?? [];
		if (masks.length === 0) throw new Error("Person segmentation returned no confidence mask");

		const mask = masks[Math.min(personMaskIndex, masks.length - 1)];
		const processed = processPersonConfidenceMask(
			mask.getAsFloat32Array(),
			mask.width,
			mask.height,
			previousTemporalMask,
		);
		previousTemporalMask = processed.temporalMask;
		cachedAlphaMask = processed.alphaMask;
		cachedMaskWidth = mask.width;
		cachedMaskHeight = mask.height;
		cachedMaskVersion++;
	});
}

function refreshScaledMask(outputWidth: number, outputHeight: number): OffscreenCanvas {
	if (!cachedAlphaMask || cachedMaskWidth <= 0 || cachedMaskHeight <= 0) {
		throw new Error("Person mask is unavailable");
	}

	[modelMaskCanvas, modelMaskContext] = ensureCanvas(
		modelMaskCanvas,
		modelMaskContext,
		cachedMaskWidth,
		cachedMaskHeight,
	);
	if (uploadedMaskVersion !== cachedMaskVersion) {
		const pixels = new Uint8ClampedArray(cachedAlphaMask.length * 4);
		for (let index = 0; index < cachedAlphaMask.length; index++) {
			const offset = index * 4;
			pixels[offset] = 255;
			pixels[offset + 1] = 255;
			pixels[offset + 2] = 255;
			pixels[offset + 3] = Math.round(Math.min(1, Math.max(0, cachedAlphaMask[index])) * 255);
		}
		modelMaskContext.putImageData(
			new ImageData(pixels, cachedMaskWidth, cachedMaskHeight),
			0,
			0,
		);
		uploadedMaskVersion = cachedMaskVersion;
	}

	[scaledMaskCanvas, scaledMaskContext] = ensureCanvas(
		scaledMaskCanvas,
		scaledMaskContext,
		outputWidth,
		outputHeight,
	);
	scaledMaskContext.clearRect(0, 0, outputWidth, outputHeight);
	scaledMaskContext.drawImage(modelMaskCanvas, 0, 0, outputWidth, outputHeight);
	return scaledMaskCanvas;
}

function compositeFrame(frame: ImageBitmap, strength: number): ImageBitmap {
	const outputWidth = Math.max(1, frame.width);
	const outputHeight = Math.max(1, frame.height);
	[outputCanvas, outputContext] = ensureCanvas(
		outputCanvas,
		outputContext,
		outputWidth,
		outputHeight,
	);
	[foregroundCanvas, foregroundContext] = ensureCanvas(
		foregroundCanvas,
		foregroundContext,
		outputWidth,
		outputHeight,
	);
	const maskCanvas = refreshScaledMask(outputWidth, outputHeight);
	const blurRadius = getWebcamBackgroundBlurRadius(strength, Math.min(outputWidth, outputHeight));
	const bleed = Math.ceil(blurRadius * 2);

	outputContext.clearRect(0, 0, outputWidth, outputHeight);
	outputContext.save();
	outputContext.filter = `blur(${blurRadius}px)`;
	outputContext.drawImage(frame, -bleed, -bleed, outputWidth + bleed * 2, outputHeight + bleed * 2);
	outputContext.restore();

	foregroundContext.clearRect(0, 0, outputWidth, outputHeight);
	foregroundContext.globalCompositeOperation = "source-over";
	foregroundContext.drawImage(frame, 0, 0, outputWidth, outputHeight);
	foregroundContext.globalCompositeOperation = "destination-in";
	foregroundContext.drawImage(maskCanvas, 0, 0, outputWidth, outputHeight);
	foregroundContext.globalCompositeOperation = "source-over";
	outputContext.drawImage(foregroundCanvas, 0, 0);

	return outputCanvas.transferToImageBitmap();
}

async function initialize(wasmBaseUrl: string, modelUrl: string): Promise<void> {
	const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl, true);
	segmenter = await ImageSegmenter.createFromOptions(vision, {
		baseOptions: {
			modelAssetPath: modelUrl,
			delegate: "CPU",
		},
		runningMode: "VIDEO",
		outputConfidenceMasks: true,
		outputCategoryMask: false,
	});
	const labels = segmenter.getLabels().map((label) => label.toLowerCase());
	const detectedPersonIndex = labels.findIndex(
		(label) => label.includes("person") || label.includes("foreground"),
	);
	personMaskIndex = detectedPersonIndex >= 0 ? detectedPersonIndex : 1;
}

function processFrame(request: WebcamEffectProcessRequest): ImageBitmap {
	const reset = shouldResetPersonMask(
		previousSourceTimeMs,
		request.sourceTimeMs,
		previousStreamKey,
		request.streamKey,
	);
	if (reset) resetTemporalState();

	const inferenceIntervalMs = 1000 / Math.max(1, request.inferenceFps);
	if (
		!cachedAlphaMask ||
		lastInferenceSourceTimeMs === null ||
		Math.abs(request.sourceTimeMs - lastInferenceSourceTimeMs) >= inferenceIntervalMs
	) {
		refreshPersonMask(request.frame);
		lastInferenceSourceTimeMs = request.sourceTimeMs;
	}

	previousSourceTimeMs = request.sourceTimeMs;
	previousStreamKey = request.streamKey;
	return compositeFrame(request.frame, request.strength);
}

workerScope.onmessage = async (event: MessageEvent<WebcamEffectWorkerRequest>) => {
	const request = event.data;
	if (request.type === "dispose") {
		segmenter?.close();
		segmenter = null;
		workerScope.close();
		return;
	}

	if (request.type === "init") {
		try {
			await initialize(request.wasmBaseUrl, request.modelUrl);
			postMessage({ type: "ready" });
		} catch (error) {
			postMessage({ type: "error", message: errorMessage(error) });
		}
		return;
	}

	try {
		const bitmap = processFrame(request);
		postMessage({ type: "frame", requestId: request.requestId, bitmap }, [bitmap]);
	} catch (error) {
		postMessage({
			type: "error",
			requestId: request.requestId,
			message: errorMessage(error),
		});
	} finally {
		request.frame.close();
	}
};
