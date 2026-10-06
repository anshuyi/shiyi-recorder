import type { ScreenTransform } from "./types";

export interface ScreenRect {
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface ScreenStage {
	width: number;
	height: number;
}
export type ScreenCorner = "nw" | "ne" | "sw" | "se";
export const MIN_SCREEN_SCALE = 0.1;
export const MAX_SCREEN_SCALE = 6;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeScreenTransform(value: unknown): ScreenTransform | null {
	if (!value || typeof value !== "object") return null;
	const v = value as ScreenTransform;
	if (![v.centerX, v.centerY, v.scale].every(Number.isFinite) || v.scale <= 0) return null;
	// Centers outside the canvas are valid when a large recording is panned.
	return {
		centerX: clamp(v.centerX, -10, 10),
		centerY: clamp(v.centerY, -10, 10),
		scale: clamp(v.scale, MIN_SCREEN_SCALE, MAX_SCREEN_SCALE),
	};
}

export function resolveScreenTransform(
	stage: ScreenStage,
	base: ScreenRect,
	value?: ScreenTransform | null,
): { rect: ScreenRect; transform: ScreenTransform } | null {
	if (
		![stage.width, stage.height, base.width, base.height].every(
			(v) => Number.isFinite(v) && v > 0,
		)
	)
		return null;
	const requested = normalizeScreenTransform(value);
	if (!requested)
		return {
			rect: { ...base },
			transform: {
				centerX: (base.x + base.width / 2) / stage.width,
				centerY: (base.y + base.height / 2) / stage.height,
				scale: 1,
			},
		};
	const scale = requested.scale;
	const width = base.width * scale;
	const height = base.height * scale;
	// Leave a reachable portion visible, while allowing either edge to cross the canvas.
	const visibleX = Math.min(width, stage.width) * 0.1;
	const visibleY = Math.min(height, stage.height) * 0.1;
	const cx = clamp(
		requested.centerX * stage.width,
		visibleX - width / 2,
		stage.width - visibleX + width / 2,
	);
	const cy = clamp(
		requested.centerY * stage.height,
		visibleY - height / 2,
		stage.height - visibleY + height / 2,
	);
	return {
		rect: { x: cx - width / 2, y: cy - height / 2, width, height },
		transform: { centerX: cx / stage.width, centerY: cy / stage.height, scale },
	};
}

export function dragScreenTransform(
	stage: ScreenStage,
	base: ScreenRect,
	start: ScreenTransform,
	dx: number,
	dy: number,
): ScreenTransform {
	return (
		resolveScreenTransform(stage, base, {
			...start,
			centerX: start.centerX + dx / stage.width,
			centerY: start.centerY + dy / stage.height,
		})?.transform ?? start
	);
}

export function resizeScreenTransform(
	stage: ScreenStage,
	base: ScreenRect,
	start: ScreenTransform,
	corner: ScreenCorner,
	dx: number,
	dy: number,
): ScreenTransform {
	const resolved = resolveScreenTransform(stage, base, start);
	if (!resolved) return start;
	const r = resolved.rect;
	const sx = corner.endsWith("e") ? 1 : -1;
	const sy = corner.startsWith("s") ? 1 : -1;
	const ax = sx === 1 ? r.x : r.x + r.width;
	const ay = sy === 1 ? r.y : r.y + r.height;
	const delta =
		(sx * dx * base.width + sy * dy * base.height) / (base.width ** 2 + base.height ** 2);
	const scale = clamp(resolved.transform.scale + delta, MIN_SCREEN_SCALE, MAX_SCREEN_SCALE);
	return resolveScreenTransform(stage, base, {
		centerX: (ax + (sx * base.width * scale) / 2) / stage.width,
		centerY: (ay + (sy * base.height * scale) / 2) / stage.height,
		scale,
	})!.transform;
}
