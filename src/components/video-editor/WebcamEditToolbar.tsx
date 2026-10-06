import {getWebcamSizeLimitPercent} from "./webcamOverlay";
import { useCallback, useState, useEffect } from "react";
import { PortraitSizeControl } from "./PortraitSizeControl";
import { useScopedT } from "@/contexts/I18nContext";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { WebcamCropControl } from "./WebcamCropControl";
import { cropAtZoom, normalizeAspectCropRegion, MIN_CROP_SIZE } from "./webcamCropGeometry";
import { getWebcamFrameAspectRatio } from "./webcamFrame";
import type { CropRegion, WebcamOverlaySettings } from "./types";
export type PortraitEditMode = "none" | "layout" | "crop";
export function WebcamEditToolbar({
	webcam,
	mode,
	draft,
	src,
	time,
	onMode,
	onDraft,
	onApply,
	onCancel,
	onReset,
	onSize,
}: {
	webcam: WebcamOverlaySettings;
	mode: PortraitEditMode;
	draft: CropRegion | null;
	src: string | null;
	time: number;
	onMode: (m: PortraitEditMode) => void;
	onDraft: (c: CropRegion) => void;
	onApply: () => void;
	onCancel: () => void;
	onReset: () => void;
	onSize: (n: number, commit: boolean) => void;
}) {
	const t = useScopedT("editor");
	const [sourceAspect, setSourceAspect] = useState<number | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (mode === "crop") {
			setSourceAspect(null);
			setFailed(false);
		}
	}, [mode, src]);
	const metadata = useCallback((v: number) => setSourceAspect(v), []);
	const aspect = (sourceAspect ?? 1) / getWebcamFrameAspectRatio(webcam.frameStyle);
	const maximum = normalizeAspectCropRegion({ x: 0, y: 0, width: 1, height: 1 }, aspect);
	const crop = normalizeAspectCropRegion(draft ?? webcam.cropRegion, aspect);
	const zoom = maximum.width / crop.width,
		maxZoom = maximum.width / Math.min(MIN_CROP_SIZE, maximum.width);
	const button = "h-7 rounded px-2 text-xs hover:bg-foreground/10 disabled:opacity-40";
	return (
		<>
			<button
				type="button"
				className={button}
				data-testid="portrait-edit"
				aria-pressed={mode !== "none"}
				title={
					!src
						? t("portrait.noSource", "Record or attach a camera video first")
						: undefined
				}
				disabled={!webcam.enabled || !src}
				onClick={() => onMode(mode === "none" ? "layout" : "none")}
			>
				{t("portrait.edit", "Edit portrait")}
			</button>
			{mode === "layout" && (
				<>
					<PortraitSizeControl max={getWebcamSizeLimitPercent(webcam?.margin??24)}
						label={t("portrait.size", "Portrait size")}
						value={webcam.size}
						onSize={onSize}
						onCancel={onCancel}
					/>
					<button
						type="button"
						className={button}
						data-testid="portrait-crop"
						onClick={() => {
							setSourceAspect(null);
							onMode("crop");
						}}
					>
						{t("portrait.crop", "Adjust framing")}
					</button>
					<button
						type="button"
						className={button}
						data-testid="portrait-reset-layout"
						onClick={onReset}
					>
						{t("portrait.resetLayout", "Reset size and position")}
					</button>
					<button type="button" className={button} onClick={() => onMode("none")}>
						{t("portrait.done", "Done")}
					</button>
				</>
			)}
			<Dialog
				open={mode === "crop"}
				onOpenChange={(open) => {
					if (!open) onCancel();
				}}
			>
				<DialogContent
					className="max-w-xl max-h-[90vh] overflow-y-auto bg-editor-panel text-foreground"
					onEscapeKeyDown={(e) => {
						e.preventDefault();
						onCancel();
					}}
				>
					<DialogHeader>
						<DialogTitle>{t("portrait.crop", "Adjust framing")}</DialogTitle>
						<DialogDescription>
							{t(
								"portrait.cropHint",
								"Move or resize the crop. The portrait frame stays in place.",
							)}
						</DialogDescription>
					</DialogHeader>
					<div
						className="mx-auto w-full"
						style={{ maxWidth: `${(sourceAspect ?? 1) * 50}vh` }}
					>
						<WebcamCropControl
							cropRegion={draft ?? webcam.cropRegion}
							frameAspectRatio={getWebcamFrameAspectRatio(webcam.frameStyle)}
							mirrored={webcam.mirror}
							previewSrc={src}
							previewCurrentTime={time}
							previewTimeOffsetMs={webcam.timeOffsetMs}
							onCropChange={onDraft}
							onMetadata={metadata}
							onError={() => {
								setFailed(true);
								setSourceAspect(null);
							}}
						/>
					</div>
					{!sourceAspect && (
						<p role="status">
							{failed
								? t(
										"portrait.loadError",
										"Unable to read the portrait video. Check the source file.",
									)
								: t("portrait.loading", "Loading portrait…")}
						</p>
					)}
					<label className="flex items-center gap-3 text-sm">
						{t("portrait.zoom", "Framing zoom")}
						<input
							data-testid="portrait-crop-zoom"
							aria-label={t("portrait.zoom", "Framing zoom")}
							className="flex-1"
							type="range"
							min="1"
							max={maxZoom}
							step=".01"
							value={zoom}
							disabled={!sourceAspect}
							onChange={(e) =>
								onDraft(cropAtZoom(crop, aspect, Number(e.target.value)))
							}
						/>
						{zoom.toFixed(2)}×
					</label>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							className={button}
							data-testid="portrait-reset-crop"
							disabled={!sourceAspect}
							onClick={() => onDraft(maximum)}
						>
							{t("portrait.resetCrop", "Reset framing")}
						</button>
						<button
							type="button"
							className={button}
							data-testid="portrait-crop-cancel"
							onClick={onCancel}
						>
							{t("portrait.cancel", "Cancel")}
						</button>
						<button
							type="button"
							className={button + " bg-blue-600 text-white"}
							data-testid="portrait-crop-apply"
							disabled={!sourceAspect}
							onClick={onApply}
						>
							{t("portrait.apply", "Apply")}
						</button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
