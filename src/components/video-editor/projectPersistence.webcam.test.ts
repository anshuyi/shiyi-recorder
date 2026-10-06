import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "./projectPersistence";
import { DEFAULT_WEBCAM_BACKGROUND_BLUR_STRENGTH, DEFAULT_WEBCAM_OVERLAY } from "./types";

describe("webcam background blur project persistence", () => {
	it("keeps the effect disabled for projects created before the setting existed", () => {
		const result = normalizeProjectEditor({
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				backgroundBlurEnabled: undefined,
				backgroundBlurStrength: undefined,
			} as unknown as typeof DEFAULT_WEBCAM_OVERLAY,
		});

		expect(result.webcam.backgroundBlurEnabled).toBe(false);
		expect(result.webcam.backgroundBlurStrength).toBe(DEFAULT_WEBCAM_BACKGROUND_BLUR_STRENGTH);
	});

	it("preserves enabled effects and clamps invalid strengths", () => {
		const tooStrong = normalizeProjectEditor({
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				backgroundBlurEnabled: true,
				backgroundBlurStrength: 4,
			},
		});
		const tooWeak = normalizeProjectEditor({
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				backgroundBlurEnabled: true,
				backgroundBlurStrength: -1,
			},
		});
		const notANumber = normalizeProjectEditor({
			webcam: {
				...DEFAULT_WEBCAM_OVERLAY,
				backgroundBlurEnabled: true,
				backgroundBlurStrength: Number.NaN,
			},
		});

		expect(tooStrong.webcam.backgroundBlurEnabled).toBe(true);
		expect(tooStrong.webcam.backgroundBlurStrength).toBe(1);
		expect(tooWeak.webcam.backgroundBlurStrength).toBe(0.1);
		expect(notANumber.webcam.backgroundBlurStrength).toBe(
			DEFAULT_WEBCAM_BACKGROUND_BLUR_STRENGTH,
		);
	});
});
