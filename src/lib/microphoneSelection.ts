export interface MicrophoneSelection { deviceId?: string; label?: string }
export interface AudioInput { deviceId: string; label: string; kind?: string }

/** Device IDs belong to an origin. Only an unambiguous label can bridge a restart. */
export function resolveMicrophoneSelection(devices: readonly AudioInput[], saved: MicrophoneSelection): MicrophoneSelection {
	const inputs = devices.filter(d => !d.kind || d.kind === "audioinput");
	if (!inputs.length) throw new Error("未找到麦克风，请连接设备后重试");
	if (!saved.deviceId || saved.deviceId === "default") return {};
	const exact = inputs.find(d => d.deviceId === saved.deviceId);
	if (exact) return { deviceId: exact.deviceId, label: exact.label || saved.label };
	const matches = saved.label ? inputs.filter(d => d.deviceId !== "default" && d.deviceId !== "communications" && d.label === saved.label) : [];
	if (matches.length === 1) return { deviceId: matches[0].deviceId, label: matches[0].label };
	throw new Error("之前选择的麦克风无法确认，请在麦克风菜单重新选择设备");
}

export function microphonePreferencePatch(selection: MicrophoneSelection) {
	return { microphoneDeviceId: selection.deviceId ?? null, microphoneDeviceLabel: selection.deviceId ? selection.label ?? null : null };
}
