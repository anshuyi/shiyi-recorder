import { describe, expect, it } from "vitest";
import { computePaddedLayout, scalePreviewBorderRadius } from "./layoutUtils";

describe("manual screen layout", () => {
	const params = { width: 900, height: 1600, videoWidth: 1920, videoHeight: 1080, padding: { top: 10, bottom: 20, left: 30, right: 40 }, cropRegion: { x: .1, y: .15, width: .8, height: .7 } };
	it("transforms the cropped source, mask and device frame together", () => {
		const frameInsets = { top: .1, bottom: .1, left: .05, right: .05 };
		const before = computePaddedLayout({ ...params, frameInsets });
		const after = computePaddedLayout({ ...params, frameInsets, screenTransform: { centerX: .45, centerY: .25, scale: .6 } });
		expect(after.frameRect.x + after.frameRect.width / 2).toBeCloseTo(405);
		expect(after.frameRect.y + after.frameRect.height / 2).toBeCloseTo(400);
		expect(after.scale).toBeCloseTo(before.scale * .6);
		expect(after.centerOffsetX - after.spriteX).toBeCloseTo(params.cropRegion.x * params.videoWidth * after.scale);
		expect(after.centerOffsetY - after.frameRect.y).toBeCloseTo(frameInsets.top * after.fullFrameDisplayH);
	});
	it.each([[900,1600], [450,800], [1080,1920]])("uses the same normalized geometry at %sx%s", (width,height) => {
		const layout = computePaddedLayout({ ...params, width, height, screenTransform: { centerX: .45, centerY: .25, scale: .6 } });
		const reference = computePaddedLayout({ ...params, screenTransform: { centerX: .45, centerY: .25, scale: .6 } });
		expect(layout.frameRect.x / width).toBeCloseTo(reference.frameRect.x / 900);
		expect(layout.frameRect.y / height).toBeCloseTo(reference.frameRect.y / 1600);
		expect(layout.frameRect.width / width).toBeCloseTo(reference.frameRect.width / 900);
	});
});

describe("scalePreviewBorderRadius", () => {
	it("matches export scaling against the logical preview size", () => {
		expect(scalePreviewBorderRadius(1920, 1080, 16)).toBeCloseTo(16, 6);
		expect(scalePreviewBorderRadius(960, 540, 16)).toBeCloseTo(8, 6);
		expect(scalePreviewBorderRadius(1440, 810, 16)).toBeCloseTo(12, 6);
	});

	it("clamps invalid or empty preview sizes to zero", () => {
		expect(scalePreviewBorderRadius(0, 540, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 0, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 540, -8)).toBe(0);
	});
});
