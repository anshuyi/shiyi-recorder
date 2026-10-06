import { describe, expect, it, vi } from "vitest";
import {
	getPortraitFramePoints,
	getWebcamFrameDimensions,
	getWebcamFrameSvgPath,
	tracePortraitFrame,
} from "./webcamFrame";
import { getWebcamAspectCropSourceRect, getWebcamOverlayPosition } from "./webcamOverlay";
import { normalizeProjectEditor } from "./projectPersistence";
import { normalizeEditorPreferences } from "./editorPreferences";
import { DEFAULT_WEBCAM_OVERLAY } from "./types";

describe("portrait webcam framing", () => {
	it("uses 3:5 while retaining the full source height for upper-body framing", () => {
		expect(getWebcamFrameDimensions(500, "portrait")).toEqual({ width: 300, height: 500 });
		expect(getWebcamAspectCropSourceRect(undefined, 1920, 1080, 0.6)).toEqual({
			sx: 636,
			sy: 0,
			sw: 648,
			sh: 1080,
		});
		expect(getWebcamFrameDimensions(500)).toEqual({ width: 500, height: 500 });
	});
	it.each([
		[1920, 1080],
		[1080, 1920],
		[640, 480],
	])("keeps a custom crop inside a %sx%s source without stretching", (width, height) => {
		const rect = getWebcamAspectCropSourceRect(
			{ x: 0.7, y: 0.1, width: 0.3, height: 0.85 },
			width,
			height,
			0.6,
		);
		expect(rect.sw / rect.sh).toBeCloseTo(0.6);
		expect(rect.sx).toBeGreaterThanOrEqual(0);
		expect(rect.sy).toBeGreaterThanOrEqual(0);
		expect(rect.sx + rect.sw).toBeLessThanOrEqual(width + 1e-8);
		expect(rect.sy + rect.sh).toBeLessThanOrEqual(height + 1e-8);
	});
	it("positions the right and bottom edges using rectangular dimensions", () => {
		expect(
			getWebcamOverlayPosition({
				containerWidth: 1920,
				containerHeight: 1080,
				size: 500,
				frameWidth: 300,
				frameHeight: 500,
				margin: 24,
				positionPreset: "bottom-right",
				positionX: 1,
				positionY: 1,
				legacyCorner: "bottom-right",
			}),
		).toEqual({ x: 1596, y: 556 });
	});
	it("uses the same stable, bounded outline for SVG, Canvas and Pixi at every resolution", () => {
		const points = getPortraitFramePoints(300, 500);
		const scaled = getPortraitFramePoints(600, 1000);
		const path = { moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn() };
		tracePortraitFrame(path, 300, 500);
		expect(path.moveTo).toHaveBeenCalledWith(...points[0]);
		expect(path.lineTo.mock.calls).toEqual(points.slice(1));
		expect(path.closePath).toHaveBeenCalledOnce();
		points.forEach(([x, y], i) => {
			expect(x).toBeGreaterThanOrEqual(0);
			expect(x).toBeLessThanOrEqual(300);
			expect(y).toBeGreaterThanOrEqual(0);
			expect(y).toBeLessThanOrEqual(500);
			expect(scaled[i]).toEqual([x * 2, y * 2]);
		});
		expect(getWebcamFrameSvgPath(300, 500, 90, "portrait")).toBe(
			getWebcamFrameSvgPath(300, 500, 0, "portrait"),
		);
	});
	it("defaults new projects to portrait and preserves legacy project appearance", () => {
		expect(normalizeProjectEditor({}).webcam.frameStyle).toBe("portrait");
		expect(
			normalizeProjectEditor({ webcam: { ...DEFAULT_WEBCAM_OVERLAY, frameStyle: undefined } })
				.webcam.frameStyle,
		).toBe("rounded");
	});
	it("round-trips crop and shape through saved editor preferences", () => {
		const webcam = {
			...DEFAULT_WEBCAM_OVERLAY,
			frameStyle: "portrait" as const,
			cropRegion: { x: 0.25, y: 0.1, width: 0.3, height: 0.8 },
		};
		const restored = normalizeEditorPreferences(JSON.parse(JSON.stringify({ webcam })));
		expect(restored.webcam.frameStyle).toBe("portrait");
		expect(restored.webcam.cropRegion).toEqual(webcam.cropRegion);
	});
});
