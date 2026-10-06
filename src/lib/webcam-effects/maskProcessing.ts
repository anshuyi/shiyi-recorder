export const PERSON_MASK_LOW_THRESHOLD = 0.35;
export const PERSON_MASK_HIGH_THRESHOLD = 0.75;
export const PERSON_MASK_RISE_ALPHA = 0.65;
export const PERSON_MASK_FALL_ALPHA = 0.35;
export const PERSON_MASK_RESET_GAP_MS = 250;

export interface PersonMaskProcessingResult {
	alphaMask: Float32Array;
	temporalMask: Float32Array;
}

function clampUnit(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
	const normalized = clampUnit(
		(value - PERSON_MASK_LOW_THRESHOLD) /
			(PERSON_MASK_HIGH_THRESHOLD - PERSON_MASK_LOW_THRESHOLD),
	);
	return normalized * normalized * (3 - 2 * normalized);
}

function dilateMask(mask: Float32Array, width: number, height: number): Float32Array {
	const result = new Float32Array(mask.length);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let maximum = 0;
			for (let offsetY = -1; offsetY <= 1; offsetY++) {
				const sampleY = Math.min(height - 1, Math.max(0, y + offsetY));
				for (let offsetX = -1; offsetX <= 1; offsetX++) {
					const sampleX = Math.min(width - 1, Math.max(0, x + offsetX));
					maximum = Math.max(maximum, mask[sampleY * width + sampleX]);
				}
			}
			result[y * width + x] = maximum;
		}
	}
	return result;
}

function featherMask(mask: Float32Array, width: number, height: number): Float32Array {
	const result = new Float32Array(mask.length);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let total = 0;
			let sampleCount = 0;
			for (let offsetY = -1; offsetY <= 1; offsetY++) {
				const sampleY = y + offsetY;
				if (sampleY < 0 || sampleY >= height) continue;
				for (let offsetX = -1; offsetX <= 1; offsetX++) {
					const sampleX = x + offsetX;
					if (sampleX < 0 || sampleX >= width) continue;
					total += mask[sampleY * width + sampleX];
					sampleCount++;
				}
			}
			result[y * width + x] = sampleCount > 0 ? total / sampleCount : 0;
		}
	}
	return result;
}

export function processPersonConfidenceMask(
	confidenceMask: Float32Array,
	width: number,
	height: number,
	previousTemporalMask?: Float32Array | null,
): PersonMaskProcessingResult {
	if (width <= 0 || height <= 0 || confidenceMask.length !== width * height) {
		throw new Error("Invalid person confidence mask dimensions");
	}

	const canReusePrevious = previousTemporalMask?.length === confidenceMask.length;
	const temporalMask = new Float32Array(confidenceMask.length);
	for (let index = 0; index < confidenceMask.length; index++) {
		const current = smoothstep(confidenceMask[index]);
		if (!canReusePrevious || !previousTemporalMask) {
			temporalMask[index] = current;
			continue;
		}

		const previous = previousTemporalMask[index];
		const alpha = current >= previous ? PERSON_MASK_RISE_ALPHA : PERSON_MASK_FALL_ALPHA;
		temporalMask[index] = previous + (current - previous) * alpha;
	}

	return {
		temporalMask,
		alphaMask: featherMask(dilateMask(temporalMask, width, height), width, height),
	};
}

export function shouldResetPersonMask(
	previousSourceTimeMs: number | null,
	sourceTimeMs: number,
	previousStreamKey: string | null,
	streamKey: string,
): boolean {
	if (previousSourceTimeMs === null || previousStreamKey !== streamKey) return true;
	const timeDelta = sourceTimeMs - previousSourceTimeMs;
	return timeDelta < 0 || timeDelta > PERSON_MASK_RESET_GAP_MS;
}

export function getWebcamBackgroundBlurRadius(strength: number, outputSize: number): number {
	const normalizedStrength = Math.min(1, Math.max(0.1, strength));
	const radiusAt720p = 6 + normalizedStrength * 22;
	return radiusAt720p * (Math.max(1, outputSize) / 720);
}
