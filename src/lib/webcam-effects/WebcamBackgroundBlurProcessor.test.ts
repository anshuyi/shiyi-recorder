import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebcamEffectWorkerRequest, WebcamEffectWorkerResponse } from "./protocol";
import { WebcamBackgroundBlurProcessor } from "./WebcamBackgroundBlurProcessor";

vi.mock("@/lib/assetPath", () => ({
	getAssetPath: vi.fn(async (path: string) => `/assets/${path}`),
}));

class FakeWorker {
	onmessage: ((event: MessageEvent<WebcamEffectWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	messages: WebcamEffectWorkerRequest[] = [];
	terminated = false;
	failProcess = false;
	processedBitmap = {
		width: 320,
		height: 320,
		close: vi.fn(),
	} as unknown as ImageBitmap;

	postMessage(message: WebcamEffectWorkerRequest): void {
		this.messages.push(message);
		queueMicrotask(() => {
			if (message.type === "init") {
				this.onmessage?.({ data: { type: "ready" } } as MessageEvent);
				return;
			}
			if (message.type !== "process") return;
			this.onmessage?.({
				data: this.failProcess
					? { type: "error", requestId: message.requestId, message: "segment failed" }
					: {
							type: "frame",
							requestId: message.requestId,
							bitmap: this.processedBitmap,
						},
			} as MessageEvent<WebcamEffectWorkerResponse>);
		});
	}

	terminate(): void {
		this.terminated = true;
	}
}

describe("WebcamBackgroundBlurProcessor", () => {
	let fakeWorker: FakeWorker;
	let drawImage: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.unstubAllGlobals();
		fakeWorker = new FakeWorker();
		drawImage = vi.fn();
		vi.stubGlobal("window", {
			setTimeout,
			clearTimeout,
		});
		vi.stubGlobal("document", {
			createElement: vi.fn(() => ({
				width: 0,
				height: 0,
				getContext: vi.fn(() => ({
					clearRect: vi.fn(),
					drawImage,
					imageSmoothingEnabled: false,
					imageSmoothingQuality: "low",
				})),
			})),
		});
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn(
				async () => ({ width: 320, height: 320, close: vi.fn() }) as unknown as ImageBitmap,
			),
		);
	});

	it("initializes from bundled assets and returns a reusable output canvas", async () => {
		const processor = new WebcamBackgroundBlurProcessor(() => fakeWorker as unknown as Worker);

		const output = await processor.process({
			source: {} as VideoFrame,
			sourceWidth: 1280,
			sourceHeight: 720,
			sourceTimeMs: 100,
			strength: 0.55,
			targetSize: 320,
			inferenceFps: 15,
		});

		expect(fakeWorker.messages[0]).toEqual({
			type: "init",
			wasmBaseUrl: "/assets/mediapipe/wasm",
			modelUrl: "/assets/mediapipe/models/selfie_segmenter.tflite",
		});
		expect(fakeWorker.messages[1]).toMatchObject({
			type: "process",
			sourceTimeMs: 100,
			strength: 0.55,
			inferenceFps: 15,
		});
		expect(output.width).toBe(320);
		expect(drawImage).toHaveBeenCalledWith(fakeWorker.processedBitmap, 0, 0);
		expect(fakeWorker.processedBitmap.close).toHaveBeenCalledOnce();

		processor.dispose();
		expect(fakeWorker.terminated).toBe(true);
	});

	it("keeps portrait framing when background blur is enabled", async () => {
		const processor = new WebcamBackgroundBlurProcessor(() => fakeWorker as unknown as Worker);
		const source = {} as VideoFrame;
		await processor.process({ source, sourceWidth: 1280, sourceHeight: 720, aspectRatio: 0.6, sourceTimeMs: 0, strength: 0.55, targetSize: 500, inferenceFps: 15 });
		expect(createImageBitmap).toHaveBeenCalledWith(source, 424, 0, 432, 720, { resizeWidth: 300, resizeHeight: 500, resizeQuality: "high" });
		processor.dispose();
	});

	it("propagates frame processing failures", async () => {
		fakeWorker.failProcess = true;
		const processor = new WebcamBackgroundBlurProcessor(() => fakeWorker as unknown as Worker);

		await expect(
			processor.process({
				source: {} as VideoFrame,
				sourceWidth: 1280,
				sourceHeight: 720,
				sourceTimeMs: 0,
				strength: 0.55,
				targetSize: 320,
				inferenceFps: 15,
			}),
		).rejects.toThrow("segment failed");
		processor.dispose();
	});

	it("releases a frame created after disposal instead of waiting for a timeout", async () => {
		let resolveBitmap: ((bitmap: ImageBitmap) => void) | null = null;
		const bitmap = { width: 320, height: 320, close: vi.fn() } as unknown as ImageBitmap;
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn(
				() =>
					new Promise<ImageBitmap>((resolve) => {
						resolveBitmap = resolve;
					}),
			),
		);
		const processor = new WebcamBackgroundBlurProcessor(() => fakeWorker as unknown as Worker);
		const pending = processor.process({
			source: {} as VideoFrame,
			sourceWidth: 1280,
			sourceHeight: 720,
			sourceTimeMs: 0,
			strength: 0.55,
			targetSize: 320,
			inferenceFps: 15,
		});

		await vi.waitFor(() => expect(resolveBitmap).not.toBeNull());
		processor.dispose();
		resolveBitmap?.(bitmap);

		await expect(pending).rejects.toThrow("processor is unavailable");
		expect(bitmap.close).toHaveBeenCalledOnce();
		expect(fakeWorker.messages.filter((message) => message.type === "process")).toHaveLength(0);
	});
});
