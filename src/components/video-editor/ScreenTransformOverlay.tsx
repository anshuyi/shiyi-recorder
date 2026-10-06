import { useEffect, useRef, type PointerEvent } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import type { ScreenTransform } from "./types";
import {
	dragScreenTransform,
	resizeScreenTransform,
	type ScreenCorner,
	type ScreenRect,
	type ScreenStage,
} from "./screenTransform";

interface Props {
	prefix?: string;
	transformGesture?: (
		start: ScreenTransform,
		corner: ScreenCorner | undefined,
		dx: number,
		dy: number,
	) => ScreenTransform;
	stage: ScreenStage;
	base: ScreenRect;
	rect: ScreenRect;
	transform: ScreenTransform;
	selected: boolean;
	onSelect: (selected: boolean) => void;
	onPreview: (value: ScreenTransform | undefined) => void;
	onCommit: (value: ScreenTransform) => void;
}

export function ScreenTransformOverlay(props: Props) {
	const t = useScopedT("editor");
	const root = useRef<HTMLDivElement>(null);
	const latest = useRef(props);
	latest.current = props;
	const previewFrame = useRef<number | null>(null);
	const cancelPreviewFrame = () => {
		if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
		previewFrame.current = null;
	};
	const gesture = useRef<{
		x: number;
		y: number;
		id: number;
		corner?: ScreenCorner;
		start: ScreenTransform;
		value: ScreenTransform;
		changed: boolean;
		stage: ScreenStage;
		base: ScreenRect;
		cssWidth: number;
		cssHeight: number;
	} | null>(null);
	const finish = (commit: boolean) => {
		cancelPreviewFrame();
		const g = gesture.current;
		gesture.current = null;
		if (!g) return;
		if (root.current?.hasPointerCapture(g.id)) root.current.releasePointerCapture(g.id);
		latest.current.onPreview(undefined);
		if (commit && g.changed) latest.current.onCommit(g.value);
	};
	useEffect(() => {
		const blur = () => finish(false);
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (!gesture.current && !latest.current.selected) return;
				if (gesture.current) finish(false);
				else latest.current.onSelect(false);
				e.preventDefault();
				e.stopPropagation();
			} else if ((e.ctrlKey || e.metaKey) && ["s", "z", "y"].includes(e.key.toLowerCase())) {
				// Preserve portrait drafts for the editor's apply/discard decision.
				if (latest.current.prefix === "webcam" && gesture.current) {
					cancelPreviewFrame();
					if (gesture.current.changed) latest.current.onPreview(gesture.current.value);
					const id = gesture.current.id;
					gesture.current = null;
					if (root.current?.hasPointerCapture(id)) root.current.releasePointerCapture(id);
				} else finish(false);
			}
		};
		window.addEventListener("blur", blur);
		window.addEventListener("keydown", key, true);
		return () => {
			window.removeEventListener("blur", blur);
			window.removeEventListener("keydown", key, true);
			finish(false);
		};
	}, []);

	const down = (e: PointerEvent, corner?: ScreenCorner) => {
		if (e.button !== 0 || gesture.current) return;
		e.preventDefault();
		e.stopPropagation();
		const bounds = root.current?.getBoundingClientRect();
		if (!bounds?.width || !bounds.height) return;
		props.onSelect(true);
		root.current!.setPointerCapture(e.pointerId);
		gesture.current = {
			x: e.clientX,
			y: e.clientY,
			id: e.pointerId,
			corner,
			start: props.transform,
			value: props.transform,
			changed: false,
			stage: props.stage,
			base: props.base,
			cssWidth: bounds.width,
			cssHeight: bounds.height,
		};
	};
	const move = (e: PointerEvent) => {
		const g = gesture.current;
		if (!g || g.id !== e.pointerId) return;
		const dx = ((e.clientX - g.x) * g.stage.width) / g.cssWidth;
		const dy = ((e.clientY - g.y) * g.stage.height) / g.cssHeight;
		g.value = props.transformGesture
			? props.transformGesture(g.start, g.corner, dx, dy)
			: g.corner
				? resizeScreenTransform(g.stage, g.base, g.start, g.corner, dx, dy)
				: dragScreenTransform(g.stage, g.base, g.start, dx, dy);
		g.changed =
			Math.abs(g.value.centerX - g.start.centerX) +
				Math.abs(g.value.centerY - g.start.centerY) +
				Math.abs(g.value.scale - g.start.scale) >
			1e-7;
		if (previewFrame.current === null)
			previewFrame.current = requestAnimationFrame(() => {
				previewFrame.current = null;
				if (gesture.current) latest.current.onPreview(gesture.current.value);
			});
	};
	const { rect, stage, selected } = props;
	const prefix = props.prefix ?? "screen";
	// Keep selection handles accessible even when the full frame extends off canvas.
	const visible = {
		x: Math.max(0, rect.x),
		y: Math.max(0, rect.y),
		width: Math.min(stage.width, rect.x + rect.width) - Math.max(0, rect.x),
		height: Math.min(stage.height, rect.y + rect.height) - Math.max(0, rect.y),
	};
	return (
		<div
			ref={root}
			className="absolute inset-0"
			style={{
				zIndex: prefix === "webcam" ? 10001 : selected ? 10000 : 2,
				pointerEvents: selected ? "auto" : "none",
				touchAction: "none",
			}}
			onPointerDown={() => props.onSelect(false)}
			onPointerMove={move}
			onPointerUp={(e) => {
				if (e.pointerId === gesture.current?.id) {
					move(e);
					finish(true);
				}
			}}
			onPointerCancel={() => finish(false)}
			onLostPointerCapture={() => finish(false)}
		>
			<div
				data-testid={`${prefix}-transform-box`}
				data-layer={prefix}
				role="button"
				tabIndex={0}
				aria-label={
					prefix === "webcam"
						? t("screenLayout.moveWebcam", "Move portrait")
						: t("screenLayout.move", "Move screen recording")
				}
				onPointerDown={(e) => down(e)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						props.onSelect(true);
					}
				}}
				className="absolute"
				style={{
					left: `${(rect.x / stage.width) * 100}%`,
					top: `${(rect.y / stage.height) * 100}%`,
					width: `${(rect.width / stage.width) * 100}%`,
					height: `${(rect.height / stage.height) * 100}%`,
					pointerEvents: "auto",
					cursor: "move",
					outline: selected ? "2px solid #2563eb" : undefined,
					outlineOffset: -2,
				}}
			></div>
			{selected && (
				<div
					className="absolute pointer-events-none"
					style={{
						left: `${(visible.x / stage.width) * 100}%`,
						top: `${(visible.y / stage.height) * 100}%`,
						width: `${(visible.width / stage.width) * 100}%`,
						height: `${(visible.height / stage.height) * 100}%`,
						outline: "2px solid #2563eb",
						outlineOffset: -2,
					}}
				>
					{(["nw", "ne", "sw", "se"] as ScreenCorner[]).map((corner) => (
						<button
							key={corner}
							type="button"
							data-testid={`${prefix}-resize-${corner}`}
							aria-label={`${t("screenLayout.resize", "Resize recording")} ${corner}`}
							onPointerDown={(e) => down(e, corner)}
							className="pointer-events-auto absolute h-3 w-3 rounded-sm border-2 border-blue-600 bg-white"
							style={{
								[corner.endsWith("e") ? "right" : "left"]: 0,
								[corner.startsWith("s") ? "bottom" : "top"]: 0,
								cursor:
									corner === "nw" || corner === "se"
										? "nwse-resize"
										: "nesw-resize",
							}}
						/>
					))}
				</div>
			)}
		</div>
	);
}
