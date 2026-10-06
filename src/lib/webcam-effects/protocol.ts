export interface WebcamEffectInitRequest {
	type: "init";
	wasmBaseUrl: string;
	modelUrl: string;
}

export interface WebcamEffectProcessRequest {
	type: "process";
	requestId: number;
	frame: ImageBitmap;
	sourceTimeMs: number;
	streamKey: string;
	strength: number;
	inferenceFps: number;
}

export interface WebcamEffectDisposeRequest {
	type: "dispose";
}

export type WebcamEffectWorkerRequest =
	| WebcamEffectInitRequest
	| WebcamEffectProcessRequest
	| WebcamEffectDisposeRequest;

export interface WebcamEffectReadyResponse {
	type: "ready";
}

export interface WebcamEffectFrameResponse {
	type: "frame";
	requestId: number;
	bitmap: ImageBitmap;
}

export interface WebcamEffectErrorResponse {
	type: "error";
	requestId?: number;
	message: string;
}

export type WebcamEffectWorkerResponse =
	| WebcamEffectReadyResponse
	| WebcamEffectFrameResponse
	| WebcamEffectErrorResponse;
