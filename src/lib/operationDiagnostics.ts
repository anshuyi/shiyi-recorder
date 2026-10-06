export function reportOperation(phase: string, state: string, elapsedMs?: number, operation?: string) {
	window.electronAPI?.reportOperation?.({phase,state,elapsedMs,operation});
}
