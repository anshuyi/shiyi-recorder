import { describe, expect, it } from "vitest";
import {
	getWebcamBackgroundBlurRadius,
	processPersonConfidenceMask,
	shouldResetPersonMask,
} from "./maskProcessing";

describe("processPersonConfidenceMask", () => {
	it("maps low confidence to background and high confidence to foreground", () => {
		const result = processPersonConfidenceMask(new Float32Array([0.2, 0.9]), 2, 1);
		expect(result.temporalMask[0]).toBe(0);
		expect(result.temporalMask[1]).toBe(1);
	});

	it("uses different temporal rates when the foreground enters and leaves", () => {
		const rising = processPersonConfidenceMask(
			new Float32Array([1]),
			1,
			1,
			new Float32Array([0]),
		);
		const falling = processPersonConfidenceMask(
			new Float32Array([0]),
			1,
			1,
			new Float32Array([1]),
		);

		expect(rising.temporalMask[0]).toBeCloseTo(0.65);
		expect(falling.temporalMask[0]).toBeCloseTo(0.65);
	});

	it("expands and feathers a thin foreground feature", () => {
		const confidence = new Float32Array(49);
		confidence[24] = 1;
		const result = processPersonConfidenceMask(confidence, 7, 7);

		expect(result.alphaMask[24]).toBe(1);
		expect(result.alphaMask[17]).toBeGreaterThan(0);
		expect(result.alphaMask[0]).toBe(0);
	});

	it("rejects mismatched mask dimensions", () => {
		expect(() => processPersonConfidenceMask(new Float32Array(3), 2, 2)).toThrow(
			"Invalid person confidence mask dimensions",
		);
	});
});

describe("shouldResetPersonMask", () => {
	it("resets after seeks, long gaps, and crop changes", () => {
		expect(shouldResetPersonMask(null, 0, null, "a")).toBe(true);
		expect(shouldResetPersonMask(100, 90, "a", "a")).toBe(true);
		expect(shouldResetPersonMask(100, 351, "a", "a")).toBe(true);
		expect(shouldResetPersonMask(100, 120, "a", "b")).toBe(true);
		expect(shouldResetPersonMask(100, 120, "a", "a")).toBe(false);
	});
});

describe("getWebcamBackgroundBlurRadius", () => {
	it("maps the strength range at 720 pixels and scales with output size", () => {
		expect(getWebcamBackgroundBlurRadius(0.1, 720)).toBeCloseTo(8.2);
		expect(getWebcamBackgroundBlurRadius(1, 720)).toBe(28);
		expect(getWebcamBackgroundBlurRadius(1, 360)).toBe(14);
	});
});
