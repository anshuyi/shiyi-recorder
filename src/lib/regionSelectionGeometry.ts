import type { CaptureRegion } from "./captureRegion";

export type RegionHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
export interface RegionPoint {
	x: number;
	y: number;
}
export interface RegionBounds {
	width: number;
	height: number;
}
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export function drawRegion(
	start: RegionPoint,
	end: RegionPoint,
	bounds: RegionBounds,
): CaptureRegion {
	const x1 = clamp(start.x, bounds.width),
		y1 = clamp(start.y, bounds.height);
	const x2 = clamp(end.x, bounds.width),
		y2 = clamp(end.y, bounds.height);
	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.abs(x2 - x1),
		height: Math.abs(y2 - y1),
	};
}

export function moveRegion(
	rect: CaptureRegion,
	delta: RegionPoint,
	bounds: RegionBounds,
): CaptureRegion {
	return {
		...rect,
		x: clamp(rect.x + delta.x, bounds.width - rect.width),
		y: clamp(rect.y + delta.y, bounds.height - rect.height),
	};
}

/** The opposite edge stays fixed even when the pointer crosses it. */
export function resizeRegion(
	rect: CaptureRegion,
	handle: RegionHandle,
	point: RegionPoint,
	bounds: RegionBounds,
): CaptureRegion {
	const left = handle.includes("w") ? point.x : rect.x;
	const right = handle.includes("e") ? point.x : rect.x + rect.width;
	const top = handle.includes("n") ? point.y : rect.y;
	const bottom = handle.includes("s") ? point.y : rect.y + rect.height;
	return drawRegion({ x: left, y: top }, { x: right, y: bottom }, bounds);
}
