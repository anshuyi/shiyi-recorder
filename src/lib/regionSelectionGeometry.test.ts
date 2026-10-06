import { describe, expect, it } from "vitest";
import { drawRegion, moveRegion, resizeRegion, type RegionHandle } from "./regionSelectionGeometry";

const bounds = { width: 1200, height: 900 };
const rect = { x: 200, y: 200, width: 400, height: 300 };
describe("free mouse region selection", () => {
	it.each([
		[800, 150],
		[150, 600],
		[320, 320],
	])("keeps arbitrary pointer dimensions %sx%s", (width, height) => {
		expect(drawRegion({ x: 100, y: 100 }, { x: 100 + width, y: 100 + height }, bounds)).toEqual(
			{ x: 100, y: 100, width, height },
		);
	});
	it.each([
		[100, 200, 700, 500],
		[700, 500, 100, 200],
		[700, 200, 100, 500],
		[100, 500, 700, 200],
	])("draws in all directions", (x1, y1, x2, y2) => {
		expect(drawRegion({ x: x1, y: y1 }, { x: x2, y: y2 }, bounds)).toEqual({
			x: 100,
			y: 200,
			width: 600,
			height: 300,
		});
	});
	it("does not turn a click into a preset rectangle", () => {
		expect(drawRegion({ x: 100, y: 200 }, { x: 100, y: 200 }, bounds)).toEqual({
			x: 100,
			y: 200,
			width: 0,
			height: 0,
		});
	});
	it.each(["w", "e"] as RegionHandle[])("changes only width at %s edge", (handle) => {
		const result = resizeRegion(rect, handle, { x: 350, y: 800 }, bounds);
		expect(result.y).toBe(200);
		expect(result.height).toBe(300);
		expect(result.width).toBe(handle === "w" ? 250 : 150);
	});
	it.each(["n", "s"] as RegionHandle[])("changes only height at %s edge", (handle) => {
		const result = resizeRegion(rect, handle, { x: 1100, y: 350 }, bounds);
		expect(result.x).toBe(200);
		expect(result.width).toBe(400);
		expect(result.height).toBe(150);
	});
	it.each([
		"nw",
		"ne",
		"sw",
		"se",
	] as RegionHandle[])("resizes corner %s without aspect lock", (handle) => {
		const result = resizeRegion(rect, handle, { x: 250, y: 480 }, bounds);
		expect(result.width).toBe(handle.includes("w") ? 350 : 50);
		expect(result.height).toBe(handle.includes("n") ? 20 : 280);
	});
	it("normalizes crossed anchors without negative sizes", () => {
		expect(resizeRegion(rect, "nw", { x: 800, y: 700 }, bounds)).toEqual({
			x: 600,
			y: 500,
			width: 200,
			height: 200,
		});
	});
	it("clamps drawing and moving at display boundaries", () => {
		expect(drawRegion({ x: -30, y: 50 }, { x: 1500, y: 1000 }, bounds)).toEqual({
			x: 0,
			y: 50,
			width: 1200,
			height: 850,
		});
		expect(moveRegion(rect, { x: 2000, y: -1000 }, bounds)).toEqual({
			x: 800,
			y: 0,
			width: 400,
			height: 300,
		});
	});
});
