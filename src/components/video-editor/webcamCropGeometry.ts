import type { CropRegion } from "./types";
import { normalizeWebcamCropRegion } from "./webcamOverlay";
export type CropHandle = "move" | "nw" | "ne" | "sw" | "se";
export const MIN_CROP_SIZE = 0.08;
function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function normalizeAspectCropRegion(
	cropRegion: CropRegion,
	displayAspectRatio: number,
): CropRegion {
	const crop = normalizeWebcamCropRegion(cropRegion);
	const aspectRatio =
		Number.isFinite(displayAspectRatio) && displayAspectRatio > 0 ? displayAspectRatio : 1;
	const maxWidth = Math.min(1, 1 / aspectRatio);
	const minWidth = Math.min(MIN_CROP_SIZE, maxWidth);
	const width = clamp(Math.min(crop.width, crop.height / aspectRatio), minWidth, maxWidth);
	const height = width * aspectRatio;
	const centerX = crop.x + crop.width / 2;
	const centerY = crop.y + crop.height / 2;
	const x = clamp(centerX - width / 2, 0, 1 - width);
	const y = clamp(centerY - height / 2, 0, 1 - height);

	return { x, y, width, height };
}

export function flipCropHorizontally(
	cropRegion: CropRegion,
	displayAspectRatio: number,
): CropRegion {
	const crop = normalizeAspectCropRegion(cropRegion, displayAspectRatio);
	return {
		...crop,
		x: clamp(1 - crop.x - crop.width, 0, 1 - crop.width),
	};
}

export function resizeCrop(
	cropRegion: CropRegion,
	handle: CropHandle,
	deltaX: number,
	deltaY: number,
	displayAspectRatio: number,
) {
	const aspectRatio =
		Number.isFinite(displayAspectRatio) && displayAspectRatio > 0 ? displayAspectRatio : 1;
	const crop = normalizeAspectCropRegion(cropRegion, aspectRatio);
	const minWidth = Math.min(MIN_CROP_SIZE, Math.min(1, 1 / aspectRatio));

	if (handle === "move") {
		return normalizeAspectCropRegion(
			{
				...crop,
				x: clamp(crop.x + deltaX, 0, 1 - crop.width),
				y: clamp(crop.y + deltaY, 0, 1 - crop.height),
			},
			aspectRatio,
		);
	}

	let left = crop.x;
	let top = crop.y;
	let right = crop.x + crop.width;
	let bottom = crop.y + crop.height;

	if (handle === "nw") {
		const delta = Math.max(deltaX, deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width - delta,
			minWidth,
			Math.min(right, bottom / aspectRatio),
		);
		left = right - nextWidth;
		top = bottom - nextWidth * aspectRatio;
	}

	if (handle === "ne") {
		const delta = Math.max(deltaX, -deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width + delta,
			minWidth,
			Math.min(1 - left, bottom / aspectRatio),
		);
		right = left + nextWidth;
		top = bottom - nextWidth * aspectRatio;
	}

	if (handle === "sw") {
		const delta = Math.max(-deltaX, deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width + delta,
			minWidth,
			Math.min(right, (1 - top) / aspectRatio),
		);
		left = right - nextWidth;
		bottom = top + nextWidth * aspectRatio;
	}

	if (handle === "se") {
		const delta = Math.max(deltaX, deltaY / aspectRatio);
		const nextWidth = clamp(
			crop.width + delta,
			minWidth,
			Math.min(1 - left, (1 - top) / aspectRatio),
		);
		right = left + nextWidth;
		bottom = top + nextWidth * aspectRatio;
	}

	return normalizeAspectCropRegion(
		{
			x: left,
			y: top,
			width: right - left,
			height: bottom - top,
		},
		aspectRatio,
	);
}

export function cropAtZoom(crop: CropRegion, aspect: number, zoom: number): CropRegion {
	const max = normalizeAspectCropRegion({ x: 0, y: 0, width: 1, height: 1 }, aspect);
	const c = normalizeAspectCropRegion(crop, aspect);
	const width = Math.max(Math.min(MIN_CROP_SIZE, max.width), max.width / Math.max(1, zoom)),
		height = width * aspect;
	return {
		x: clamp(c.x + c.width / 2 - width / 2, 0, 1 - width),
		y: clamp(c.y + c.height / 2 - height / 2, 0, 1 - height),
		width,
		height,
	};
}
