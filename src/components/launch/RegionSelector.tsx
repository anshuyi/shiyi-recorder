import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
	captureRegionPixels,
	type CaptureRegion,
	type CaptureRegionContext,
} from "@/lib/captureRegion";
import {
	drawRegion,
	moveRegion,
	resizeRegion,
	type RegionHandle,
	type RegionPoint,
} from "@/lib/regionSelectionGeometry";

type Gesture = {
	mode: "draw" | "move" | RegionHandle;
	start: RegionPoint;
	original: CaptureRegion | null;
};
const handles: RegionHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const handleLabels = {
	n: "上边",
	s: "下边",
	w: "左边",
	e: "右边",
	nw: "左上角",
	ne: "右上角",
	sw: "左下角",
	se: "右下角",
};

export function RegionSelector() {
	const [context, setContext] = useState<CaptureRegionContext | null>(null);
	const [rect, setRect] = useState<CaptureRegion | null>(null);
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const root = useRef<HTMLDivElement>(null);
	const drag = useRef<Gesture | null>(null);
	useEffect(() => {
		void window.electronAPI
			.getCaptureRegionContext()
			.then((c) => {
				if (c) setContext(c);
				else setError("无法读取显示器，请取消后重新选择");
			})
			.catch(() => setError("无法读取显示器，请取消后重新选择"));
	}, []);
	const normalized =
		context && rect
			? {
					x: rect.x / context.width,
					y: rect.y / context.height,
					width: rect.width / context.width,
					height: rect.height / context.height,
				}
			: null;
	let pixels = { width: 0, height: 0 };
	try {
		if (context && normalized)
			pixels = captureRegionPixels(normalized, context.pixelWidth, context.pixelHeight);
	} catch {
		/* A click or a freshly drawn rectangle may be too small. */
	}
	const valid = pixels.width >= 48 && pixels.height >= 48;
	const finish = async (cancel = false) => {
		if (busyRef.current || (!cancel && (!valid || drag.current))) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const ok = await window.electronAPI.finishCaptureRegion(
				cancel ? null : { region: normalized! },
			);
			if (!ok) {
				setError("选区无效，请重新框选");
				busyRef.current = false;
				setBusy(false);
			}
		} catch {
			setError("无法确认选区，请重试");
			busyRef.current = false;
			setBusy(false);
		}
	};
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				void finish(true);
			}
			if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
				e.preventDefault();
				void finish();
			}
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	});
	const begin = (e: PointerEvent, mode: Gesture["mode"]) => {
		if (e.button !== 0 || busyRef.current || !context || drag.current) return;
		if (mode !== "draw" && !rect) return;
		e.preventDefault();
		e.stopPropagation();
		root.current?.setPointerCapture(e.pointerId);
		const start = { x: e.clientX, y: e.clientY };
		drag.current = { mode, start, original: rect };
		if (mode === "draw") setRect(drawRegion(start, start, context));
		setDragging(true);
		setError("");
	};
	const update = (e: PointerEvent) => {
		const d = drag.current;
		if (!d || !context) return;
		// Native transparent windows may release pointer capture while the button is held.
		// Keep tracking the gesture over the full-screen surface; a later hover ends it.
		if (e.type === "pointermove" && (e.buttons & 1) === 0) {
			drag.current = null;
			setDragging(false);
			return;
		}
		const point = { x: e.clientX, y: e.clientY };
		if (d.mode === "draw") setRect(drawRegion(d.start, point, context));
		else if (d.original && d.mode === "move")
			setRect(
				moveRegion(d.original, { x: point.x - d.start.x, y: point.y - d.start.y }, context),
			);
		else if (d.original)
			setRect(resizeRegion(d.original, d.mode as RegionHandle, point, context));
	};
	const end = (e: PointerEvent) => {
		if (!drag.current) return;
		update(e);
		drag.current = null;
		setDragging(false);
		if (root.current?.hasPointerCapture(e.pointerId))
			root.current.releasePointerCapture(e.pointerId);
	};
	const cancelGesture = () => {
		if (!drag.current) return;
		setRect(drag.current.original);
		drag.current = null;
		setDragging(false);
	};
	const restorePrevious = () => {
		const r = context?.previousRegion;
		if (!context || !r) return;
		setRect({
			x: r.x * context.width,
			y: r.y * context.height,
			width: r.width * context.width,
			height: r.height * context.height,
		});
		setError("");
	};
	const toolbarTop =
		rect && context
			? rect.y > 110
				? rect.y - 100
				: Math.max(12, Math.min(context.height - 110, rect.y + rect.height + 20))
			: 24;
	return (
		<div
			ref={root}
			data-testid="region-selector"
			onPointerDown={(e) => begin(e, "draw")}
			onPointerMove={update}
			onPointerUp={end}
			onPointerCancel={cancelGesture}
			style={{
				position: "fixed",
				inset: 0,
				overflow: "hidden",
				cursor: "crosshair",
				userSelect: "none",
				touchAction: "none",
				color: "white",
				fontFamily: "sans-serif",
				background: rect ? "transparent" : "rgba(0,0,0,.35)",
			}}
		>
			{rect && (
				<div
					data-testid="capture-rectangle"
					onPointerDown={(e) => begin(e, "move")}
					style={{
						position: "absolute",
						left: rect.x,
						top: rect.y,
						width: rect.width,
						height: rect.height,
						outline: "2px solid #60a5fa",
						boxShadow: "0 0 0 9999px rgba(0,0,0,.48)",
						cursor: "move",
					}}
				>
					{!dragging &&
						handles.map((handle) => (
							<button
								type="button"
								key={handle}
								tabIndex={-1}
								aria-label={`调整${handleLabels[handle]}`}
								data-testid={`region-${handle}`}
								onPointerDown={(e) => begin(e, handle)}
								style={{
									position: "absolute",
									padding: 0,
									width: 16,
									height: 16,
									border: "2px solid white",
									borderRadius: 3,
									background: "#2563eb",
									left: handle.includes("w")
										? -8
										: handle.includes("e")
											? undefined
											: "calc(50% - 8px)",
									right: handle.includes("e") ? -8 : undefined,
									top: handle.includes("n")
										? -8
										: handle.includes("s")
											? undefined
											: "calc(50% - 8px)",
									bottom: handle.includes("s") ? -8 : undefined,
									cursor:
										handle === "n" || handle === "s"
											? "ns-resize"
											: handle === "e" || handle === "w"
												? "ew-resize"
												: handle === "nw" || handle === "se"
													? "nwse-resize"
													: "nesw-resize",
								}}
							/>
						))}
				</div>
			)}
			<div
				data-testid="region-toolbar"
				onPointerDown={(e) => e.stopPropagation()}
				style={{
					position: "absolute",
					left: "50%",
					top: toolbarTop,
					transform: "translateX(-50%)",
					width: "max-content",
					maxWidth: "95%",
					cursor: "default",
					padding: "12px 18px",
					borderRadius: 12,
					background: "#171923",
					boxShadow: "0 4px 24px #0006",
					visibility: dragging ? "hidden" : "visible",
				}}
			>
				<div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
					<strong>自定义录制区域</strong>
					<span data-testid="region-size">
						{rect ? `${pixels.width} × ${pixels.height} px` : "用鼠标自由框选"}
					</span>
					{rect && (
						<button
							type="button"
							data-testid="region-reset"
							disabled={busy}
							onClick={() => {
								setRect(null);
								setError("");
							}}
						>
							重新框选
						</button>
					)}
					{context?.previousRegion && (
						<button
							type="button"
							data-testid="region-restore"
							disabled={busy}
							onClick={restorePrevious}
						>
							使用上次选区
						</button>
					)}
					<button type="button" onClick={() => void finish(true)} disabled={busy}>
						取消 Esc
					</button>
					<button
						type="button"
						data-testid="region-confirm"
						onClick={() => void finish()}
						disabled={!valid || dragging || busy}
						style={{
							background: valid && !dragging ? "#2563eb" : "#444",
							padding: "6px 12px",
							borderRadius: 6,
						}}
					>
						确认 Enter
					</button>
				</div>
				<div role="status" style={{ fontSize: 12, color: "#cbd5e1", marginTop: 8 }}>
					{error ||
						(rect
							? valid
								? "拖动内部移动 · 拖动边或角调整宽高 · 确认后点击录制"
								: "选区太小，请拖动边或角扩大选区"
							: "按住鼠标拖动，选择要录制的区域，宽高不限")}
				</div>
			</div>
		</div>
	);
}
