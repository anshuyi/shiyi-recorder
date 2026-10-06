import { useRef } from "react";

/** Preview continuously, but add just one history entry per completed gesture. */
export function PortraitSizeControl({
	value,
	label,
	onSize,
	onCancel,
	testId = "portrait-size",
	max = 100,
}: {
	value: number;
	label: string;
	onSize: (value: number, commit: boolean) => void;
	onCancel: () => void;
	testId?: string;
	max?: number;
}) {
	const editing = useRef(false);
	return (
		<label className="flex items-center gap-2 text-xs">
			{label}
			<input
				data-testid={testId}
				aria-label={label}
				type="range"
				min="10"
				max={max}
				step="0.1"
				value={Math.min(value, max)}
				onChange={(e) => {
					editing.current = true;
					onSize(Number(e.target.value), false);
				}}
				onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
				onPointerUp={(e) => {
					if (editing.current) {
						editing.current = false;
						onSize(Number(e.currentTarget.value), true);
					}
				}}
				onPointerCancel={() => {
					if (editing.current) {
						editing.current = false;
						onCancel();
					}
				}}
				onKeyUp={(e) => {
					if (
						[
							"ArrowLeft",
							"ArrowRight",
							"ArrowUp",
							"ArrowDown",
							"Home",
							"End",
							"PageUp",
							"PageDown",
						].includes(e.key) &&
						editing.current
					) {
						editing.current = false;
						onSize(Number(e.currentTarget.value), true);
					}
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape" && editing.current) {
						editing.current = false;
						onCancel();
						e.stopPropagation();
					}
				}}
				className="min-w-12 w-24"
			/>
			<span className="tabular-nums">{Number(Math.min(value, max).toFixed(1))}%</span>
		</label>
	);
}
