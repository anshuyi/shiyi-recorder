import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Toaster } from "./components/ui/sonner";
import { useI18n } from "./contexts/I18nContext";
const RegionSelector = lazy(() => import("./components/launch/RegionSelector").then(m => ({ default: m.RegionSelector })));
const LaunchWindow = lazy(() => import("./components/launch/LaunchWindow").then(m => ({ default: m.LaunchWindow })));
const SourceSelector = lazy(() => import("./components/launch/SourceSelector").then(m => ({ default: m.SourceSelector })));
const CountdownOverlay = lazy(() => import("./components/countdown/CountdownOverlay").then(m => ({ default: m.CountdownOverlay })));
const UpdateToastWindow = lazy(() => import("./components/launch/UpdateToastWindow").then(m => ({ default: m.UpdateToastWindow })));
const EditorWindow = lazy(() => import("./components/video-editor/EditorWindow"));

class WindowLoadBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
	state = {failed: false};
	static getDerivedStateFromError() { return {failed: true}; }
	render() {
		return this.state.failed ? <div role="alert" style={{padding:24,background:'#171923',color:'white'}}>
			界面加载失败。<button onClick={() => window.location.reload()}>重新加载</button>
			{location.search.includes('region-selector') && <button onClick={() => void window.electronAPI.finishCaptureRegion(null)}>取消选区</button>}
		</div> : this.props.children;
	}
}

export default function App() {
	return <WindowLoadBoundary><Suspense fallback={<div role="status" style={{padding:16,color:'white',background:'#171923'}}>正在加载…</div>}><WindowContent /></Suspense></WindowLoadBoundary>;
}

function WindowContent() {
	const [windowType] = useState(() => new URLSearchParams(window.location.search).get("windowType") || "");
	const { t } = useI18n();
	const isMacOS = /mac/i.test(navigator.platform);
	const appIconSrc = "/app-icons/shiyi-128.png";

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const type = params.get("windowType") || "";
		document.documentElement.dataset.windowType = type;

		if (
			type === "hud-overlay" ||
			type === "source-selector" ||
			type === "region-selector" ||
			type === "countdown" ||
			(type === "update-toast" && isMacOS)
		) {
			document.body.style.background = "transparent";
			document.documentElement.style.background = "transparent";
			document.getElementById("root")?.style.setProperty("background", "transparent");
		}

		if (type === "hud-overlay") {
			document.documentElement.classList.add("hud-overlay-window");
			document.body.classList.add("hud-overlay-window");
			document.getElementById("root")?.classList.add("hud-overlay-window");
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		} else if (type === "update-toast") {
			document.documentElement.style.overflow = "visible";
			document.body.style.overflow = "visible";
			document.getElementById("root")?.style.setProperty("overflow", "visible");
		}

	}, []);

	useEffect(() => {
		document.title =
			windowType === "editor"
				? t("app.editorTitle", "Shiyi Recorder Editor")
				: t("app.name", "Shiyi Recorder");
	}, [windowType, t]);

	switch (windowType) {
		case "hud-overlay":
			return (
				<>
					<LaunchWindow />
					<Toaster className="pointer-events-auto" />
				</>
			);
		case "region-selector":
			return <RegionSelector />;
		case "source-selector":
			return <SourceSelector />;
		case "countdown":
			return <CountdownOverlay />;
		case "update-toast":
			return <UpdateToastWindow />;
		case "editor":
			return <EditorWindow />;
		default:
			return (
				<div className="flex h-full w-full items-center justify-center bg-editor-bg text-foreground">
					<div className="flex items-center gap-4 rounded-2xl border border-foreground/10 bg-foreground/5 px-6 py-5 shadow-2xl shadow-black/30 backdrop-blur-xl">
						<img
							src={appIconSrc}
							alt={t("app.name", "Shiyi Recorder")}
							className="h-12 w-12 rounded-xl"
						/>
						<div>
							<h1 className="text-xl font-semibold tracking-tight">
								{t("app.name", "Shiyi Recorder")}
							</h1>
							<p className="text-sm text-foreground/65">
								{t("app.subtitle", "Screen recording and editing")}
							</p>
						</div>
					</div>
				</div>
			);
	}
}
