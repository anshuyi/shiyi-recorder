/** Coordinates relative to the entire selected display, independent of DPI. */
export interface CaptureRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface CaptureRegionContext {
	width: number;
	height: number;
	scaleFactor: number;
	pixelWidth: number;
	pixelHeight: number;
	previousRegion?: CaptureRegion;
}

export function isCaptureRegion(value: unknown): value is CaptureRegion {
	if (!value || typeof value !== "object") return false;
	const r = value as CaptureRegion;
	return (
		[r.x, r.y, r.width, r.height].every(Number.isFinite) &&
		r.x >= 0 &&
		r.y >= 0 &&
		r.width > 0 &&
		r.height > 0 &&
		r.x + r.width <= 1.000000001 &&
		r.y + r.height <= 1.000000001
	);
}

/** Use inward rounding: never capture a pixel outside the selected rectangle. */
export function captureRegionPixels(r: CaptureRegion, width: number, height: number) {
	if (!isCaptureRegion(r) || width < 2 || height < 2) throw new Error("录制区域无效，请重新选择");
	const x = Math.ceil(r.x * width - 1e-7);
	const y = Math.ceil(r.y * height - 1e-7);
	const right = Math.min(width, Math.floor((r.x + r.width) * width + 1e-7));
	const bottom = Math.min(height, Math.floor((r.y + r.height) * height + 1e-7));
	const result = {
		x,
		y,
		width: Math.floor((right - x) / 2) * 2,
		height: Math.floor((bottom - y) / 2) * 2,
	};
	if (result.width < 2 || result.height < 2) throw new Error("录制区域太小，请重新选择");
	return result;
}

export function regionCursorPoint(x: number, y: number, region: CaptureRegion) {
	const cx = (x - region.x) / region.width;
	const cy = (y - region.y) / region.height;
	return {
		cx: Math.max(0, Math.min(1, cx)),
		cy: Math.max(0, Math.min(1, cy)),
		inside: cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1,
	};
}
