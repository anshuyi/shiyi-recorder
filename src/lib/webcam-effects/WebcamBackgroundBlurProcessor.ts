import type { CropRegion } from "@/components/video-editor/types";
import { getWebcamAspectCropSourceRect } from "@/components/video-editor/webcamOverlay";
import { getAssetPath } from "@/lib/assetPath";
import type {
	WebcamEffectProcessRequest,
	WebcamEffectWorkerRequest,
	WebcamEffectWorkerResponse,
} from "./protocol";

const PROCESS_TIMEOUT_MS = 30_000;
const INITIALIZE_TIMEOUT_MS = 30_000;
const MAX_EFFECT_SIZE = 720;

interface PendingFrame {
	resolve: (bitmap: ImageBitmap) => void;
	reject: (error: Error) => void;
	timeoutId: number;
}

export interface WebcamBackgroundBlurFrameOptions {
	source: CanvasImageSource | VideoFrame;
	sourceWidth: number;
	sourceHeight: number;
	cropRegion?: Partial<CropRegion> | null;
	aspectRatio?: number;
	sourceTimeMs: number;
	strength: number;
	targetSize: number;
	inferenceFps: number;
}

type WorkerFactory = () => Worker;

function createDefaultWorker(): Worker {
	return new Worker(new URL("./webcamBackgroundBlur.worker.ts", import.meta.url), {
		type: "module",
		name: "recordly-webcam-background-blur",
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizeWasmBaseUrl(url: string): string {
	// FilesetResolver appends its own slash before the module filename.
	return url.replace(/\/+$/, "");
}

export class WebcamBackgroundBlurProcessor {
	private readonly workerFactory: WorkerFactory;
	private worker: Worker | null = null;
	private initializePromise: Promise<void> | null = null;
	private resolveInitialization: (() => void) | null = null;
	private rejectInitialization: ((error: Error) => void) | null = null;
	private initializationTimeoutId: number | null = null;
	private pendingFrames = new Map<number, PendingFrame>();
	private nextRequestId = 1;
	private outputCanvas: HTMLCanvasElement | null = null;
	private outputContext: CanvasRenderingContext2D | null = null;
	private processQueue: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(workerFactory: WorkerFactory = createDefaultWorker) {
		this.workerFactory = workerFactory;
	}

	async initialize(): Promise<void> {
		if (this.disposed) throw new Error("Webcam background blur processor is disposed");
		if (this.initializePromise) return this.initializePromise;

		this.initializePromise = (async () => {
			const [wasmBaseUrl, modelUrl] = await Promise.all([
				getAssetPath("mediapipe/wasm"),
				getAssetPath("mediapipe/models/selfie_segmenter.tflite"),
			]);
			if (this.disposed) throw new Error("Webcam background blur processor is disposed");

			const worker = this.workerFactory();
			this.worker = worker;
			worker.onmessage = (event: MessageEvent<WebcamEffectWorkerResponse>) => {
				this.handleWorkerMessage(event.data);
			};
			worker.onerror = (event) => {
				this.failAll(new Error(event.message || "Webcam background blur worker failed"));
			};

			await new Promise<void>((resolve, reject) => {
				this.resolveInitialization = resolve;
				this.rejectInitialization = reject;
				this.initializationTimeoutId = window.setTimeout(() => {
					this.initializationTimeoutId = null;
					this.failAll(new Error("Webcam background blur initialization timed out"));
				}, INITIALIZE_TIMEOUT_MS);
				const request: WebcamEffectWorkerRequest = {
					type: "init",
					wasmBaseUrl: normalizeWasmBaseUrl(wasmBaseUrl),
					modelUrl,
				};
				worker.postMessage(request);
			});
		})();

		return this.initializePromise;
	}

	process(options: WebcamBackgroundBlurFrameOptions): Promise<HTMLCanvasElement> {
		const operation = this.processQueue.then(() => this.processFrame(options));
		this.processQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private async processFrame(
		options: WebcamBackgroundBlurFrameOptions,
	): Promise<HTMLCanvasElement> {
		await this.initialize();
		if (this.disposed || !this.worker) {
			throw new Error("Webcam background blur processor is unavailable");
		}

		const sourceRect = getWebcamAspectCropSourceRect(
			options.cropRegion,
			options.sourceWidth,
			options.sourceHeight,
			options.aspectRatio,
		);
		const availableSize = Math.max(1, Math.floor(Math.max(sourceRect.sw, sourceRect.sh)));
		const targetSize = Math.max(
			1,
			Math.min(MAX_EFFECT_SIZE, availableSize, Math.round(options.targetSize)),
		);
		const cropX = Math.max(0, Math.round(sourceRect.sx));
		const cropY = Math.max(0, Math.round(sourceRect.sy));
		const cropWidth = Math.max(
			1,
			Math.min(Math.round(sourceRect.sw), Math.floor(options.sourceWidth - cropX)),
		);
		const cropHeight = Math.max(
			1,
			Math.min(Math.round(sourceRect.sh), Math.floor(options.sourceHeight - cropY)),
		);
		const scale = targetSize / Math.max(cropWidth, cropHeight);
		const bitmap = await createImageBitmap(
			options.source as ImageBitmapSource,
			cropX,
			cropY,
			cropWidth,
			cropHeight,
			{
				resizeWidth: Math.max(1, Math.round(cropWidth * scale)),
				resizeHeight: Math.max(1, Math.round(cropHeight * scale)),
				resizeQuality: "high",
			},
		);
		const worker = this.worker;
		if (this.disposed || !worker) {
			bitmap.close();
			throw new Error("Webcam background blur processor is unavailable");
		}

		const requestId = this.nextRequestId++;
		const streamKey = [
			Math.round(options.sourceWidth),
			Math.round(options.sourceHeight),
			cropX,
			cropY,
			cropWidth,
			cropHeight,
		].join(":");
		const request: WebcamEffectProcessRequest = {
			type: "process",
			requestId,
			frame: bitmap,
			sourceTimeMs: options.sourceTimeMs,
			streamKey,
			strength: Math.min(1, Math.max(0.1, options.strength)),
			inferenceFps: Math.max(1, options.inferenceFps),
		};

		const processedBitmap = await new Promise<ImageBitmap>((resolve, reject) => {
			const timeoutId = window.setTimeout(() => {
				this.pendingFrames.delete(requestId);
				reject(new Error("Webcam background blur frame timed out"));
			}, PROCESS_TIMEOUT_MS);
			this.pendingFrames.set(requestId, { resolve, reject, timeoutId });
			try {
				worker.postMessage(request, [bitmap]);
			} catch (error) {
				window.clearTimeout(timeoutId);
				this.pendingFrames.delete(requestId);
				bitmap.close();
				reject(
					new Error(
						`Unable to send webcam background blur frame: ${errorMessage(error)}`,
					),
				);
			}
		});

		try {
			this.ensureOutputCanvas(processedBitmap.width, processedBitmap.height);
			if (!this.outputCanvas || !this.outputContext) {
				throw new Error("Unable to create webcam background blur output canvas");
			}
			this.outputContext.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
			this.outputContext.drawImage(processedBitmap, 0, 0);
			return this.outputCanvas;
		} finally {
			processedBitmap.close();
		}
	}

	private ensureOutputCanvas(width: number, height: number): void {
		if (
			this.outputCanvas &&
			this.outputContext &&
			this.outputCanvas.width === width &&
			this.outputCanvas.height === height
		) {
			return;
		}
		this.outputCanvas = document.createElement("canvas");
		this.outputCanvas.width = width;
		this.outputCanvas.height = height;
		this.outputContext = this.outputCanvas.getContext("2d");
		if (this.outputContext) {
			this.outputContext.imageSmoothingEnabled = true;
			this.outputContext.imageSmoothingQuality = "high";
		}
	}

	private handleWorkerMessage(response: WebcamEffectWorkerResponse): void {
		if (response.type === "ready") {
			if (this.initializationTimeoutId !== null) {
				window.clearTimeout(this.initializationTimeoutId);
				this.initializationTimeoutId = null;
			}
			this.resolveInitialization?.();
			this.resolveInitialization = null;
			this.rejectInitialization = null;
			return;
		}

		if (response.type === "error") {
			const error = new Error(response.message);
			if (response.requestId !== undefined) {
				const pending = this.pendingFrames.get(response.requestId);
				if (pending) {
					window.clearTimeout(pending.timeoutId);
					this.pendingFrames.delete(response.requestId);
					pending.reject(error);
				}
				return;
			}
			this.failAll(error);
			return;
		}

		const pending = this.pendingFrames.get(response.requestId);
		if (!pending) {
			response.bitmap.close();
			return;
		}
		window.clearTimeout(pending.timeoutId);
		this.pendingFrames.delete(response.requestId);
		pending.resolve(response.bitmap);
	}

	private failAll(error: Error): void {
		if (this.initializationTimeoutId !== null) {
			window.clearTimeout(this.initializationTimeoutId);
			this.initializationTimeoutId = null;
		}
		this.rejectInitialization?.(error);
		this.resolveInitialization = null;
		this.rejectInitialization = null;
		for (const pending of this.pendingFrames.values()) {
			window.clearTimeout(pending.timeoutId);
			pending.reject(error);
		}
		this.pendingFrames.clear();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.worker?.postMessage({ type: "dispose" } satisfies WebcamEffectWorkerRequest);
		this.worker?.terminate();
		this.worker = null;
		this.failAll(new Error("Webcam background blur processor was disposed"));
		this.outputCanvas = null;
		this.outputContext = null;
	}
}

export function getWebcamBackgroundBlurErrorMessage(error: unknown): string {
	return errorMessage(error);
}
