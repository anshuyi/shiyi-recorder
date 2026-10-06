import { nativeScreenRecordingActive, isCursorCaptureActive } from "./ipc/state";
import { getMonitorHandles } from "./ipc/monitorResolver";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPackagedRendererBaseUrl } from "./rendererServer";
import {
	isCaptureRegion,
	captureRegionPixels,
	type CaptureRegionContext,
} from "../src/lib/captureRegion";
import { recordResponsiveness } from "./diagnostics/responsiveness";
import type { SelectedSource } from "./ipc/types";

export function registerRegionSelectorHandlers() {
	let selecting = false;
	let generation = 0;
	let ownerId: number | null = null;
	let preparationTimer: ReturnType<typeof setTimeout> | undefined;
	let cleanupPreparation = () => {};
	let completing = false;
	let selector: BrowserWindow | null = null;
	let context: CaptureRegionContext | null = null;
	let finish: ((value: SelectedSource | null) => void) | null = null;
	let selected: SelectedSource | null = null;
	let saving = Promise.resolve();
	let rejectSelection: ((error: Error) => void) | null = null;
	const settingsPath = () => path.join(app.getPath("userData"), "capture-region.json");
	const close = (value: SelectedSource | null, error?: Error) => {
		generation++;
		clearTimeout(preparationTimer);
		cleanupPreparation();
		selecting = false;
		completing = false;
		ownerId = null;
		const resolve = finish;
		const reject = rejectSelection;
		rejectSelection = null;
		finish = null;
		const win = selector;
		selector = null;
		context = null;
		if (win && !win.isDestroyed()) win.destroy();
		recordResponsiveness("region", error ? "error" : value ? "end" : "cancel");
		if (error) reject?.(error); else resolve?.(value);
	};
	ipcMain.handle("select-capture-region", async (event, source: SelectedSource) => {
		if (selecting || nativeScreenRecordingActive || isCursorCaptureActive) return null;
		selecting = true;
		const version = ++generation;
		ownerId = event.sender.id;
		const cancelled = new Promise<SelectedSource | null>((resolve, reject) => { finish = resolve; rejectSelection = reject; });
		const cancelPreparation = () => { if (version === generation) close(null); };
		screen.on("display-removed", cancelPreparation);
		screen.on("display-metrics-changed", cancelPreparation);
		event.sender.once("destroyed", cancelPreparation);
		cleanupPreparation = () => {
			screen.removeListener("display-removed", cancelPreparation);
			screen.removeListener("display-metrics-changed", cancelPreparation);
			event.sender.removeListener("destroyed", cancelPreparation);
		};
		preparationTimer = setTimeout(() => { if (version === generation) close(null, new Error("选区准备超时，请重试")); }, 12000);
		recordResponsiveness("region", "start");
		const prepare = async () => {
		try {
			if (!source?.id?.startsWith("screen:")) throw new Error("请选择一个显示器");
			const display = screen.getAllDisplays().find((d) => String(d.id) === source.display_id);
			if (!display) throw new Error("显示器已断开，请重新选择");
			const width = display.bounds.width,
				height = display.bounds.height;
			const center =
				process.platform === "win32"
					? screen.dipToScreenPoint({
							x: Math.round(display.bounds.x + width / 2),
							y: Math.round(display.bounds.y + height / 2),
						})
					: null;
			const physical = center
				? (await getMonitorHandles()).find(
						(m) =>
							center.x >= m.x &&
							center.x < m.x + m.width &&
							center.y >= m.y &&
							center.y < m.y + m.height,
					)
				: null;
			if (version !== generation) return null;
			if (center && !physical) throw new Error("无法读取显示器，请重试");
			context = {
				width,
				height,
				scaleFactor: display.scaleFactor,
				pixelWidth: physical?.width ?? Math.round(width * display.scaleFactor),
				pixelHeight: physical?.height ?? Math.round(height * display.scaleFactor),
			};
			try {
				const saved = JSON.parse(await fs.readFile(settingsPath(), "utf8"))[
					String(display.id)
				];
				if (saved && isCaptureRegion(saved.region)) {
					if (version === generation && context) context.previousRegion = saved.region;
				}
			} catch {
				/* First selection has no preferences yet. */
			}
			if (version !== generation) return null;
			selected = { ...source, sourceType: "screen" };
			const win = new BrowserWindow({
				...display.bounds,
				frame: false,
				transparent: true,
				alwaysOnTop: true,
				skipTaskbar: true,
				resizable: false,
				movable: false,
				hasShadow: false,
				show: false,
				fullscreen: true,
				webPreferences: {
					preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.mjs"),
					nodeIntegration: false,
					contextIsolation: true,
					backgroundThrottling: false,
				},
			});
			selector = win;
			win.setAlwaysOnTop(true, "screen-saver");
			win.setContentProtection(true);
			const cancel = () => { if (version === generation) close(null); };
			win.on("unresponsive", () => { if (version === generation) close(null, new Error("选区未响应，请重试")); });
			win.webContents.on("render-process-gone", () => { if (version === generation) close(null, new Error("选区窗口已退出，请重试")); });
			win.webContents.on("before-input-event", (e, input) => { if (input.type === "keyDown" && input.key === "Escape") { e.preventDefault(); cancel(); } });
			screen.on("display-removed", cancel);
			screen.on("display-metrics-changed", cancel);
			event.sender.once("destroyed", cancel);
			win.on("closed", () => {
				screen.removeListener("display-removed", cancel);
				screen.removeListener("display-metrics-changed", cancel);
				event.sender.removeListener("destroyed", cancel);
				if (selector === win) close(null);
			});
			const result = cancelled;
			win.once("ready-to-show", () => {
				if (version !== generation || win.isDestroyed()) return;
				win.show();
				win.focus();
			});
			const base = process.env.VITE_DEV_SERVER_URL || getPackagedRendererBaseUrl();
			try {
				if (base)
					await win.loadURL(`${base.replace(/\/$/, "")}/?windowType=region-selector`);
				else
					await win.loadFile(path.join(app.getAppPath(), "dist/index.html"), {
						query: { windowType: "region-selector" },
					});
			} catch {
				cancel();
			}
			return await result;
		} catch (error) {
			if (version === generation) close(null, error instanceof Error ? error : new Error("无法打开选区"));
			recordResponsiveness("region", "error");
			throw error;
		}
		};
		return Promise.race([prepare(), cancelled]);
	});
	ipcMain.handle("cancel-capture-region", event => {
		if (ownerId !== event.sender.id) return false;
		close(null); return true;
	});
	ipcMain.handle("get-capture-region-context", (event) => {
		if (selector?.webContents !== event.sender) return null;
		clearTimeout(preparationTimer);
		recordResponsiveness("region", "ready");
		return context;
	});
	ipcMain.handle("finish-capture-region", async (event, value: { region: unknown } | null) => {
		if (
			completing ||
			!selector ||
			selector.webContents !== event.sender ||
			!context ||
			!selected
		)
			return false;
		if (value === null) {
			close(null);
			return true;
		}
		if (!isCaptureRegion(value.region)) return false;
		const pixels = captureRegionPixels(value.region, context.pixelWidth, context.pixelHeight);
		if (pixels.width < 48 || pixels.height < 48) return false;
		completing = true;
				const displayId = String(selected.display_id);
		const result = {
			...selected,
			captureRegion: value.region,
			captureRegionFrameSize: { width: context.pixelWidth, height: context.pixelHeight },
			name: `自定义区域 · ${pixels.width} × ${pixels.height}`,
			windowTitle: undefined,
		};
		const region = value.region;
		saving = saving.then(async () => {
			let saved: Record<string, unknown> = {};
			try {
				const parsed = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
			} catch { /* no preferences */ }
			saved[displayId] = {region};
			await fs.writeFile(settingsPath(), JSON.stringify(saved), "utf8");
		}).catch(() => recordResponsiveness("region", "error"));
		close(result);
		return true;
	});
}
