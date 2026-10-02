import type { HerdrPane } from "../../shared/protocol.ts";
import type { Machine } from "../../shared/machines.ts";
import type { AppState } from "./appStore.ts";

export const selectSelectedMachine = (state: AppState): Machine | undefined =>
  state.machines.find((machine) => machine.id === state.selectedMachineId);

export const selectSnapshot = (state: AppState) => selectSelectedMachine(state)?.snapshot ?? null;

export const selectSelectedPane = (state: AppState): HerdrPane | null =>
  selectSnapshot(state)?.panes.find((pane) => pane.pane_id === state.selectedPaneId) ?? null;

export const selectHasSelectedPane = (state: AppState): boolean => selectSelectedPane(state) !== null;

export const selectSelectedWorkspace = (state: AppState) => {
  const pane = selectSelectedPane(state);
  if (!pane) return null;
  return selectSnapshot(state)?.workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id) ?? null;
};

export const selectTargetHerdr = (state: AppState) =>
  state.selectedMachineId === "local" ? state.health?.herdr : selectSelectedMachine(state)?.herdr;

export const selectTerminalAttach = (state: AppState): boolean => {
  const herdr = selectTargetHerdr(state);
  return herdr?.terminal_attach !== false || herdr?.terminal_mirror === true;
};

export const selectCanSignOut = (state: AppState): boolean =>
  state.auth?.authenticated === true && (state.auth.via === "token" || state.auth.via === "device");

export function findPane(machine: Machine | undefined, paneId: string): HerdrPane | undefined {
  return machine?.snapshot?.panes.find((pane) => pane.pane_id === paneId);
}
