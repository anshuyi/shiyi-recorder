import { describe, expect, it } from "vitest";
import {
	dragScreenTransform,
	normalizeScreenTransform,
	resizeScreenTransform,
	resolveScreenTransform,
	type ScreenCorner,
} from "./screenTransform";

describe("screen layout geometry", () => {
	const stage = { width: 900, height: 1600 };
	const base = { x: 50, y: 575, width: 800, height: 450 };
	const start = { centerX: 0.5, centerY: 0.5, scale: 0.5 };
	it("preserves asymmetric legacy placement", () => {
		const asymmetric = { ...base, x: 80, y: 230 };
		expect(resolveScreenTransform(stage, asymmetric)?.rect).toEqual(asymmetric);
	});
	it("rejects missing, nonfinite and negative data", () => {
		for (const input of [
			undefined,
			{},
			{ ...start, scale: 0 },
			{ ...start, centerX: NaN },
			{ ...start, scale: Infinity },
		])
			expect(normalizeScreenTransform(input)).toBeNull();
		expect(resolveScreenTransform({ width: 0, height: 50 }, base, start)).toBeNull();
	});
	it("allows partial off-canvas movement while keeping a visible strip", () => {
		const moved = dragScreenTransform(stage, base, start, -900, -1600);
		expect(resolveScreenTransform(stage, base, moved)?.rect).toEqual({
			x: -360,
			y: -202.5,
			width: 400,
			height: 225,
		});
	});
	it.each([
		"nw",
		"ne",
		"sw",
		"se",
	] as ScreenCorner[])("keeps opposite corner fixed when resizing %s", (corner) => {
		const before = resolveScreenTransform(stage, base, start)!.rect;
		const after = resolveScreenTransform(
			stage,
			base,
			resizeScreenTransform(stage, base, start, corner, 90, 50),
		)!.rect;
		const east = corner.endsWith("e"),
			south = corner.startsWith("s");
		expect(after.x + (east ? 0 : after.width)).toBeCloseTo(
			before.x + (east ? 0 : before.width),
		);
		expect(after.y + (south ? 0 : after.height)).toBeCloseTo(
			before.y + (south ? 0 : before.height),
		);
		expect(after.width / after.height).toBeCloseTo(16 / 9);
	});
	it("allows large corner drags beyond the canvas without moving the anchor", () => {
		const after = resolveScreenTransform(
			stage,
			base,
			resizeScreenTransform(stage, base, start, "se", 1e5, 1e5),
		)!.rect;
		expect(after.x).toBeCloseTo(250);
		expect(after.y).toBeCloseTo(687.5);
		expect(after.width).toBe(4800);
		expect(after.x + after.width).toBeGreaterThan(stage.width);
		expect(after.y + after.height).toBeGreaterThan(stage.height);
	});
});
