import { describe, expect, it } from "vitest";
import {
	getWebcamCropSourceRect,
	getWebcamMarginPx,
	getWebcamOverlayPosition,
	getWebcamOverlaySizePx,
	getWebcamSquareCropSourceRect,
	isWebcamCropRegionDefault,
	normalizeWebcamCropRegion,
} from "./webcamOverlay";

describe("portrait layout across preview and export sizes", () => {
	it.each([10, 60, 100].flatMap(size => (["portrait", "rounded"] as const).map(style => [size,style] as const)))("keeps normalized geometry at size %s / %s", (sizePercent,frameStyle) => {
		const layouts = [300, 648, 1080].map((width) => {
			const height = (width * 16) / 9;
			const margin = getWebcamMarginPx(width, height, 24, frameStyle);
			const size = getWebcamOverlaySizePx({
				containerWidth: width,
				containerHeight: height,
				sizePercent,
				margin,
				zoomScale: 1,
				reactToZoom: false,
				frameStyle,
			});
			const position = getWebcamOverlayPosition({
				containerWidth: width,
				containerHeight: height,
				size,
				frameWidth: size * (frameStyle==="portrait"?.6:1),
				frameHeight: size,
				margin,
				positionPreset: "custom",
				positionX: 0.64,
				positionY: 0.78,
				legacyCorner: "bottom-right",
			});
			return { x: position.x / width, y: position.y / height, size: size / width };
		});
		for (const result of layouts) {
			expect(result.x).toBeCloseTo(layouts[0].x);
			expect(result.y).toBeCloseTo(layouts[0].y);
			expect(result.size).toBeCloseTo(layouts[0].size);
		}
	});
});

describe("normalizeWebcamCropRegion", () => {
	it("defaults to the full webcam frame", () => {
		expect(normalizeWebcamCropRegion()).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		expect(isWebcamCropRegionDefault()).toBe(true);
	});

	it("clamps crop dimensions inside the source frame", () => {
		const crop = normalizeWebcamCropRegion({ x: 0.8, y: -1, width: 0.5, height: 2 });
		expect(crop.x).toBe(0.8);
		expect(crop.y).toBe(0);
		expect(crop.width).toBeCloseTo(0.2);
		expect(crop.height).toBe(1);
	});
});

describe("getWebcamCropSourceRect", () => {
	it("converts normalized crop settings to source pixels", () => {
		expect(
			getWebcamCropSourceRect({ x: 0.25, y: 0.1, width: 0.5, height: 0.75 }, 1920, 1080),
		).toEqual({
			sx: 480,
			sy: 108,
			sw: 960,
			sh: 810,
		});
	});

	it("centers the visible square inside a landscape source", () => {
		expect(getWebcamSquareCropSourceRect(undefined, 1280, 720)).toEqual({
			sx: 280,
			sy: 0,
			sw: 720,
			sh: 720,
		});
	});

	it("centers the visible square inside a custom portrait crop", () => {
		expect(
			getWebcamSquareCropSourceRect(
				{ x: 0.25, y: 0.1, width: 0.25, height: 0.8 },
				1920,
				1080,
			),
		).toEqual({
			sx: 480,
			sy: 300,
			sw: 480,
			sh: 480,
		});
	});
});
