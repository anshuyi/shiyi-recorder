import { describe, expect, it } from "vitest";
import { captureRegionPixels, isCaptureRegion, regionCursorPoint } from "./captureRegion";

describe("capture region", () => {
	it.each([
		1, 1.25, 1.5, 2,
	])("maps logical selection at %sx DPI to actual video pixels", (scale) => {
		expect(
			captureRegionPixels(
				{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
				1920 * scale,
				1080 * scale,
			),
		).toEqual({
			x: 480 * scale,
			y: Math.ceil(270 * scale),
			width: 960 * scale,
			height: Math.floor((540 * scale) / 2) * 2,
		});
	});
	it("rounds inward and aligns encoding dimensions without leaking outside pixels", () => {
		const r = captureRegionPixels(
			{ x: 0.123, y: 0.117, width: 0.31, height: 0.27 },
			1919,
			1079,
		);
		expect(r.x).toBeGreaterThanOrEqual(0.123 * 1919);
		expect(r.y).toBeGreaterThanOrEqual(0.117 * 1079);
		expect(r.x + r.width).toBeLessThanOrEqual(0.433 * 1919);
		expect(r.y + r.height).toBeLessThanOrEqual(0.387 * 1079);
		expect((r.width % 2) + (r.height % 2)).toBe(0);
	});
	it.each([
		null,
		{},
		{ x: -1, y: 0, width: 1, height: 1 },
		{ x: 0, y: 0, width: 0, height: 1 },
		{ x: 0.5, y: 0, width: 1, height: 1 },
		{ x: NaN, y: 0, width: 1, height: 1 },
	])("rejects invalid region %j", (value) => expect(isCaptureRegion(value)).toBe(false));
	it("maps region center and excludes clicks outside it", () => {
		const region = { x: 0.25, y: 0.2, width: 0.5, height: 0.6 };
		expect(regionCursorPoint(0.5, 0.5, region)).toEqual({ cx: 0.5, cy: 0.5, inside: true });
		expect(regionCursorPoint(0.1, 0.5, region).inside).toBe(false);
	});
	it("rejects rectangles smaller than one encodable pixel pair", () => {
		expect(() =>
			captureRegionPixels({ x: 0, y: 0, width: 0.001, height: 0.001 }, 100, 100),
		).toThrow();
	});
});
