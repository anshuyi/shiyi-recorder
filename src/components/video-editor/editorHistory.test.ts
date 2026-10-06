import {DEFAULT_WEBCAM_OVERLAY} from "./types";
import {captureWebcamEditSettings} from "./editorHistory";
import { describe, expect, it } from "vitest";

import {
	areEditorHistorySnapshotsEqual,
	cloneEditorHistorySnapshot,
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	resetEditorHistoryStack,
	undoEditorHistoryStack,
} from "./editorHistory";

function createSnapshot(id: string | null): EditorHistorySnapshot {
	return {
		zoomRegions: [],
		clipRegions: [],
		speedRegions: [],
		annotationRegions: [],
		audioRegions: [],
		autoCaptions: [],
		selectedZoomId: id,
		selectedClipId: id ? `clip-${id}` : null,
		selectedAnnotationId: null,
		selectedAudioId: null,
	};
}

describe("editorHistory", () => {
	it("undoes a committed screen gesture in one step and redoes it", () => {
		const stack = createEditorHistoryStack();
		const initial = { ...createSnapshot(null), screenTransform: null };
		const moved = { ...initial, screenTransform: { centerX: .5, centerY: .2, scale: .65 } };
		recordEditorHistorySnapshot(stack, initial);
		recordEditorHistorySnapshot(stack, moved);
		expect(stack.past).toHaveLength(1);
		expect(undoEditorHistoryStack(stack, moved)?.screenTransform).toBeNull();
		expect(redoEditorHistoryStack(stack, initial)?.screenTransform).toEqual(moved.screenTransform);
	});
	it("initializes without adding undo history", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("first");

		expect(recordEditorHistorySnapshot(stack, snapshot)).toBe("initialized");

		expect(stack.current).toEqual(snapshot);
		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("does not record unchanged snapshots", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("same");

		recordEditorHistorySnapshot(stack, snapshot);
		expect(recordEditorHistorySnapshot(stack, createSnapshot("same"))).toBe("unchanged");

		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("records changes and clears redo history", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		stack.future.push(createSnapshot("future"));

		expect(recordEditorHistorySnapshot(stack, createSnapshot("third"))).toBe("recorded");

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first", "second"]);
		expect(stack.current?.selectedZoomId).toBe("third");
		expect(stack.future).toEqual([]);
	});

	it("moves snapshots through undo and redo stacks", () => {
		const stack = createEditorHistoryStack();
		const first = createSnapshot("first");
		const second = createSnapshot("second");

		recordEditorHistorySnapshot(stack, first);
		recordEditorHistorySnapshot(stack, second);

		expect(undoEditorHistoryStack(stack, second)?.selectedZoomId).toBe("first");
		expect(stack.current?.selectedZoomId).toBe("first");
		expect(stack.future.map((snapshot) => snapshot.selectedZoomId)).toEqual(["second"]);

		expect(redoEditorHistoryStack(stack, first)?.selectedZoomId).toBe("second");
		expect(stack.current?.selectedZoomId).toBe("second");
		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first"]);
	});

	it("updates the current snapshot while applying history without recording a new entry", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		expect(
			recordEditorHistorySnapshot(stack, createSnapshot("applied"), {
				applyingHistory: true,
			}),
		).toBe("applied");

		expect(stack.current?.selectedZoomId).toBe("applied");
		expect(stack.past).toEqual([]);
	});

	it("caps the past stack at the configured history depth", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("0"));
		recordEditorHistorySnapshot(stack, createSnapshot("1"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("2"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("3"), { maxEntries: 2 });

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["1", "2"]);
	});

	it("resets all history stacks", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		undoEditorHistoryStack(stack, createSnapshot("second"));
		resetEditorHistoryStack(stack);

		expect(stack).toEqual(createEditorHistoryStack());
	});

	it("clones snapshots before storing them", () => {
		const snapshot = createSnapshot("first");
		const cloned = cloneEditorHistorySnapshot(snapshot);

		cloned.selectedZoomId = "changed";

		expect(snapshot.selectedZoomId).toBe("first");
		expect(areEditorHistorySnapshotsEqual(snapshot, createSnapshot("first"))).toBe(true);
	});
});

it("undoes portrait edits once without rewinding attached camera media",()=>{
 const stack=createEditorHistoryStack();
 const initial={...createSnapshot(null),webcam:captureWebcamEditSettings({...DEFAULT_WEBCAM_OVERLAY,size:20})};
 const changed={...initial,webcam:{...initial.webcam,size:60,cropRegion:{x:.2,y:.1,width:.3,height:.5}}};
 recordEditorHistorySnapshot(stack,initial);recordEditorHistorySnapshot(stack,changed);
 const attached={...DEFAULT_WEBCAM_OVERLAY,...changed.webcam,enabled:true,sourcePath:"late-camera.mp4",timeOffsetMs:120};
 expect(recordEditorHistorySnapshot(stack,{...changed,webcam:captureWebcamEditSettings(attached)})).toBe("unchanged");
 expect(stack.past).toHaveLength(1);
 const previous=undoEditorHistoryStack(stack,changed)!;
 expect({...attached,...previous.webcam}).toMatchObject({size:20,enabled:true,sourcePath:"late-camera.mp4",timeOffsetMs:120});
 expect(redoEditorHistoryStack(stack,previous)?.webcam).toEqual(changed.webcam);
});
