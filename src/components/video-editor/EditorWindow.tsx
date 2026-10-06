import { useEffect } from "react";
import VideoEditor from "./VideoEditor";
import { ShortcutsConfigDialog } from "./ShortcutsConfigDialog";
import { ShortcutsProvider } from "../../contexts/ShortcutsContext";
import { loadAllCustomFonts } from "../../lib/customFonts";

export default function EditorWindow() {
	useEffect(() => { void loadAllCustomFonts().catch(() => undefined); }, []);
	return <ShortcutsProvider><VideoEditor /><ShortcutsConfigDialog /></ShortcutsProvider>;
}
