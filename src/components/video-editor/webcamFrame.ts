import { getSquircleSvgPath } from "@/lib/geometry/squircle";
import type { WebcamOverlaySettings } from "./types";

export type WebcamFrameStyle = NonNullable<WebcamOverlaySettings["frameStyle"]>;
export const PORTRAIT_WEBCAM_ASPECT_RATIO = 3 / 5;

export function getWebcamFrameAspectRatio(style?: WebcamFrameStyle): number {
	return style === "portrait" ? PORTRAIT_WEBCAM_ASPECT_RATIO : 1;
}

export function getWebcamFrameDimensions(size: number, style?: WebcamFrameStyle) {
	return { width: size * getWebcamFrameAspectRatio(style), height: size };
}

// Fixed, normalized paper edges. They never change between frames or export resolutions.
const PAPER_POINTS: ReadonlyArray<readonly [number, number]> = (() => {
	const points: Array<readonly [number, number]> = [];
	const noise = (index: number) => {
		const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
		return value - Math.floor(value);
	};
	for (let edge = 0; edge < 4; edge++) {
		const steps = edge % 2 === 0 ? 36 : 60;
		for (let i = 0; i < steps; i++) {
			const t = i / steps;
			const inset = 0.003 + noise(edge * 101 + i) * 0.009;
			const corner = i === 0 ? 0.01 : t;
			if (edge === 0) points.push([corner, inset * PORTRAIT_WEBCAM_ASPECT_RATIO]);
			if (edge === 1) points.push([1 - inset, corner]);
			if (edge === 2) points.push([1 - corner, 1 - inset * PORTRAIT_WEBCAM_ASPECT_RATIO]);
			if (edge === 3) points.push([inset, 1 - corner]);
		}
	}
	return points;
})();

export function getPortraitFramePoints(width: number, height: number) {
	return PAPER_POINTS.map(([x, y]) => [x * width, y * height] as const);
}

export function tracePortraitFrame(
	path: {
		moveTo(x: number, y: number): unknown;
		lineTo(x: number, y: number): unknown;
		closePath(): unknown;
	},
	width: number,
	height: number,
	x = 0,
	y = 0,
) {
	PAPER_POINTS.forEach(([px, py], i) => {
		if (i === 0) path.moveTo(x + px * width, y + py * height);
		else path.lineTo(x + px * width, y + py * height);
	});
	path.closePath();
}

export function getWebcamFrameSvgPath(
	width: number,
	height: number,
	radius: number,
	style?: WebcamFrameStyle,
) {
	if (style !== "portrait") return getSquircleSvgPath({ x: 0, y: 0, width, height, radius });
	return `${getPortraitFramePoints(width, height)
		.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`)
		.join(" ")} Z`;
}
