import type { PaneView } from "../lib/actions.ts";
import { getApp, setApp } from "./appStore.ts";
import { rememberView, storeSelection } from "./persistence.ts";
import { selectSnapshot } from "./selectors.ts";

export function selectTarget(machineId: string, paneId: string | null): void {
  const switchesMachine = machineId !== getApp().selectedMachineId;
  setApp({
    ...(switchesMachine ? { connected: false } : {}),
    selectedMachineId: machineId,
    selectedPaneId: paneId,
    autoSelected: false,
    drawerOpen: false,
    outputStopped: false,
  });
  storeSelection(machineId, paneId);
}

export function selectPane(paneId: string): void {
  setApp({ selectedPaneId: paneId, autoSelected: false, drawerOpen: false });
}

export function selectAdjacentPane(direction: -1 | 1): void {
  const state = getApp();
  const panes = selectSnapshot(state)?.panes ?? [];
  if (panes.length === 0) return;
  const index = panes.findIndex((pane) => pane.pane_id === state.selectedPaneId);
  const next = panes[(index + direction + panes.length) % panes.length];
  if (next) selectPane(next.pane_id);
}

export function setView(view: PaneView): void {
  const { selectedMachineId, selectedPaneId } = getApp();
  setApp({ view, autoSelected: false });
  if (selectedPaneId !== null) rememberView(selectedMachineId, selectedPaneId, view);
}

export function toggleView(): void {
  setView(getApp().view === "chat" ? "terminal" : "chat");
}
