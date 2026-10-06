import { ScreenTransformOverlay } from "./ScreenTransformOverlay";
import type { ScreenStage } from "./screenTransform";
import type { WebcamOverlaySettings } from "./types";
import {
	getWebcamEditGeometry,
	transformWebcam,
	webcamSettingsFromTransform,
} from "./webcamTransform";
export function WebcamTransformOverlay({
	stage,
	webcam,
	selected,
	onSelect,
	onPreview,
	onCommit,
	zoomScale = 1,
}: {
	stage: ScreenStage;
	webcam: WebcamOverlaySettings;
	selected: boolean;
	zoomScale?: number;
	onSelect: (value: boolean) => void;
	onPreview: (value: WebcamOverlaySettings | undefined) => void;
	onCommit: (value: WebcamOverlaySettings) => void;
}) {
	const geometry = getWebcamEditGeometry(stage, webcam, zoomScale);
	if (!geometry) return null;
	return (
		<ScreenTransformOverlay
			prefix="webcam"
			stage={stage}
			{...geometry}
			selected={selected}
			onSelect={onSelect}
			transformGesture={(start, corner, dx, dy) =>
				transformWebcam(stage, webcam, start, corner, dx, dy, zoomScale)
			}
			onPreview={(v) =>
				onPreview(v ? webcamSettingsFromTransform(stage, webcam, v, zoomScale) : undefined)
			}
			onCommit={(v) => onCommit(webcamSettingsFromTransform(stage, webcam, v, zoomScale))}
		/>
	);
}
