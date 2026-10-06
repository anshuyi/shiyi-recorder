import { describe, expect, it } from "vitest";
import { createProjectData, normalizeProjectEditor } from "./projectPersistence";

describe("saved screen layout", () => {
	it("keeps old projects on their automatic layout", () => {
		expect(normalizeProjectEditor({}).screenTransform).toBeNull();
	});
	it("round trips through the actual project JSON format", () => {
		const screenTransform = { centerX: -0.42, centerY: 0.23, scale: 2.5 };
		const saved = JSON.parse(
			JSON.stringify(createProjectData("C:/video.mp4", { screenTransform })),
		);
		expect(normalizeProjectEditor(saved.editor).screenTransform).toEqual(screenTransform);
	});
	it("sanitizes corrupt project state", () => {
		expect(
			normalizeProjectEditor({ screenTransform: { centerX: 500, centerY: -200, scale: 0.5 } })
				.screenTransform,
		).toEqual({ centerX: 10, centerY: -10, scale: 0.5 });
		expect(
			normalizeProjectEditor({ screenTransform: { centerX: 0.2, centerY: 0.4, scale: -1 } })
				.screenTransform,
		).toBeNull();
	});
});
