import { describe, it, expect } from "vitest";
import { resolveMicrophoneSelection as resolve, microphonePreferencePatch } from "./microphoneSelection";
const devices = [{ deviceId: "default", label: "Default - Mic" }, { deviceId: "new", label: "Mic" }];
describe("microphone selection across origins", () => {
	it("resolves a changed ID by unique label", () => expect(resolve(devices, { deviceId: "old", label: "Mic" }).deviceId).toBe("new"));
	it("uses a currently valid ID", () => expect(resolve(devices, { deviceId: "new" }).label).toBe("Mic"));
	it("does not silently replace a legacy selection without a label", () => expect(() => resolve(devices, { deviceId: "old" })).toThrow("重新选择"));
	it("rejects ambiguous devices", () => expect(() => resolve([...devices, { deviceId: "other", label: "Mic" }], { deviceId: "old", label: "Mic" })).toThrow());
	it("rejects a removed device", () => expect(() => resolve(devices, { deviceId: "old", label: "USB" })).toThrow());
	it("rejects no inputs", () => expect(() => resolve([], {})).toThrow());
	it("keeps default selection explicit", () => expect(resolve(devices, { deviceId: "default" })).toEqual({}));
	it("clears old ID and label through JSON IPC", () => expect(JSON.parse(JSON.stringify(microphonePreferencePatch({})))).toEqual({ microphoneDeviceId: null, microphoneDeviceLabel: null }));
});
