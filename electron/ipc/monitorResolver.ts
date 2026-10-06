import { execFile } from "node:child_process";

/**
 * Represents a Windows monitor handle and its physical desktop coordinates.
 */
export interface WinMonitorHandle {
	handle: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Retrieves raw HMONITOR handles from the Windows OS using a PowerShell bridge.
 * This is necessary because Electron's display IDs are often internal hashes that 
 * cannot be used directly with native Windows APIs like Graphics Capture (WGC).
 */
export function createMonitorResolver(query: () => Promise<WinMonitorHandle[]>, ttlMs = 5000) {
	let generation = 0;
	let cached: { value: WinMonitorHandle[]; expires: number } | null = null;
	let pending: Promise<WinMonitorHandle[]> | null = null;
	return {
		invalidate() { generation++; cached = null; pending = null; },
		get(): Promise<WinMonitorHandle[]> {
			if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
			if (pending) return pending;
			const version = generation;
			const request = Promise.resolve().then(query).then(value => {
				if (version !== generation) return [];
				if (value.length) cached = { value, expires: Date.now() + ttlMs };
				return value;
			}).catch(() => []).finally(() => { if (pending === request) pending = null; });
			pending = request;
			return request;
		},
	};
}

export function parseMonitorHandles(stdout: string): WinMonitorHandle[] {
	return stdout.split(/\r?\n/).filter(line => line.trim()).flatMap(line => {
		const values = line.trim().split("|").map(Number);
		if (values.length !== 5 || !values.every(Number.isFinite)) return [];
		const [handle, x, y, width, height] = values;
		if (!Number.isSafeInteger(handle) || handle <= 0 || width <= 0 || height <= 0) return [];
		return [{handle, x, y, width, height}];
	});
}

async function queryMonitorHandles(): Promise<WinMonitorHandle[]> {
	if (process.platform !== "win32") return [];

	// PowerShell snippet that uses P/Invoke to call EnumDisplayMonitors and return raw handles + bounds.
	const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public class MonitorHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);

    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref Rect lprcMonitor, IntPtr dwData);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    public static List<string> GetMonitors() {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        List<string> result = new List<string>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr hMonitor, IntPtr hdcMonitor, ref Rect lprcMonitor, IntPtr dwData) => {
            result.Add(string.Format("{0}|{1}|{2}|{3}|{4}", hMonitor.ToInt64(), lprcMonitor.left, lprcMonitor.top, lprcMonitor.right - lprcMonitor.left, lprcMonitor.bottom - lprcMonitor.top));
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
"@
[MonitorHelper]::GetMonitors()
`.trim();

	return new Promise(resolve => {
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
			encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024,
		}, (error, stdout) => resolve(error ? [] : parseMonitorHandles(stdout)));
	});
}

const resolver = createMonitorResolver(queryMonitorHandles);
export const getMonitorHandles = resolver.get;
export const invalidateMonitorHandles = resolver.invalidate;
