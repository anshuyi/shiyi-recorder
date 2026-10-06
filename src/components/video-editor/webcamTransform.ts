import type { ScreenTransform, WebcamOverlaySettings } from "./types";
import type { ScreenStage, ScreenCorner } from "./screenTransform";
import { getWebcamFrameDimensions, getWebcamFrameAspectRatio } from "./webcamFrame";
import {
	getWebcamMarginPx,
	getWebcamOverlayPosition,
	getWebcamOverlaySizePx,
	getWebcamOverlayScale,
} from "./webcamOverlay";
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function getWebcamEditGeometry(stage: ScreenStage, webcam: WebcamOverlaySettings, zoom = 1) {
	if (![stage.width, stage.height].every((v) => Number.isFinite(v) && v > 0)) return null;
	const short = Math.min(stage.width, stage.height),
		margin = getWebcamMarginPx(stage.width, stage.height, webcam.margin, webcam.frameStyle);
	const height = getWebcamOverlaySizePx({
		containerWidth: stage.width,
		containerHeight: stage.height,
		sizePercent: webcam.size,
		margin,
		zoomScale: zoom,
		reactToZoom: webcam.reactToZoom,
		frameStyle: webcam.frameStyle,
	});
	const frame = getWebcamFrameDimensions(height, webcam.frameStyle);
	const position = getWebcamOverlayPosition({
		containerWidth: stage.width,
		containerHeight: stage.height,
		size: height,
		frameWidth: frame.width,
		frameHeight: frame.height,
		margin,
		positionPreset: webcam.positionPreset,
		positionX: webcam.positionX,
		positionY: webcam.positionY,
		legacyCorner: webcam.corner,
	});
	return {
		rect: { ...position, ...frame },
		margin,
		transform: {
			centerX: (position.x + frame.width / 2) / stage.width,
			centerY: (position.y + frame.height / 2) / stage.height,
			scale: height / short,
		},
		base: { x: 0, y: 0, ...getWebcamFrameDimensions(short, webcam.frameStyle) },
	};
}
export function webcamSettingsFromTransform(
	stage: ScreenStage,
	webcam: WebcamOverlaySettings,
	value: ScreenTransform,
	zoom = 1,
): WebcamOverlaySettings {
	const g = getWebcamEditGeometry(stage, webcam, zoom);
	if (!g) return webcam;
	const factor = getWebcamOverlayScale(zoom, webcam.reactToZoom);
	const size = clamp((value.scale * 100) / factor, 10, 100);
	const frame = getWebcamEditGeometry(stage, { ...webcam, size }, zoom)!.rect;
	const fraction = (center: number, extent: number, length: number) =>
		length - extent - 2 * g.margin > 0
			? clamp(
					(center * length - extent / 2 - g.margin) / (length - extent - 2 * g.margin),
					0,
					1,
				)
			: 0.5;
	return {
		...webcam,
		size,
		positionPreset: "custom",
		positionX: fraction(value.centerX, frame.width, stage.width),
		positionY: fraction(value.centerY, frame.height, stage.height),
	};
}
export function transformWebcam(
	stage: ScreenStage,
	webcam: WebcamOverlaySettings,
	start: ScreenTransform,
	corner: ScreenCorner | undefined,
	dx: number,
	dy: number,
	zoom = 1,
): ScreenTransform {
	const g = getWebcamEditGeometry(stage, webcam, zoom);
	if (!g) return start;
	const short = Math.min(stage.width, stage.height),
		ratio = getWebcamFrameAspectRatio(webcam.frameStyle),
		margin = g.margin;
	let h = start.scale * short,
		cx = start.centerX * stage.width,
		cy = start.centerY * stage.height;
	if (!corner) {
		cx += dx;
		cy += dy;
	} else {
		const sx = corner.endsWith("e") ? 1 : -1,
			sy = corner.startsWith("s") ? 1 : -1;
		const anchorX = cx - (sx * h * ratio) / 2,
			anchorY = cy - (sy * h) / 2;
		const low = getWebcamEditGeometry(stage, { ...webcam, size: 10 }, zoom)!.rect.height;
		const high = getWebcamEditGeometry(stage, { ...webcam, size: 100 }, zoom)!.rect.height;
		const available = Math.min(
			(sx > 0 ? stage.width - margin - anchorX : anchorX - margin) / ratio,
			sy > 0 ? stage.height - margin - anchorY : anchorY - margin,
			high,
		);
		h = clamp(
			h + (sx * dx * ratio + sy * dy) / (ratio * ratio + 1),
			Math.min(low, available),
			available,
		);
		cx = anchorX + (sx * h * ratio) / 2;
		cy = anchorY + (sy * h) / 2;
	}
	cx = clamp(cx, margin + (h * ratio) / 2, stage.width - margin - (h * ratio) / 2);
	cy = clamp(cy, margin + h / 2, stage.height - margin - h / 2);
	return { centerX: cx / stage.width, centerY: cy / stage.height, scale: h / short };
}
