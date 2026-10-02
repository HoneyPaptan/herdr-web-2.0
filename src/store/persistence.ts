import { paneStorageId } from "../../shared/machines.ts";
import type { DefaultView } from "../lib/settings.ts";
import type { PaneView } from "../lib/actions.ts";

const SELECTION_KEY = "herdr-web-ui:selection";
const STORAGES = ["sessionStorage", "localStorage"] as const;

type StoredSelection = { machine_id?: string; pane_id?: string | null };

export function paneFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("pane");
}

function storedSelection(): StoredSelection | null {
  for (const storage of STORAGES) {
    try {
      const value: unknown = JSON.parse(window[storage].getItem(SELECTION_KEY) ?? "null");
      if (value !== null && typeof value === "object") return value as StoredSelection;
    } catch {}
  }
  return null;
}

export function storeSelection(machineId: string, paneId: string | null): void {
  for (const storage of STORAGES) {
    try { window[storage].setItem(SELECTION_KEY, JSON.stringify({ machine_id: machineId, pane_id: paneId })); } catch {}
  }
}

export function initialMachineId(): string {
  const query = new URLSearchParams(window.location.search);
  if (query.has("pane")) return query.get("machine") ?? "local";
  return storedSelection()?.machine_id ?? "local";
}

export function initialPaneId(): string | null {
  return paneFromUrl() ?? storedSelection()?.pane_id ?? null;
}

function viewKey(machineId: string, paneId: string): string {
  return `herdr-web-ui:view:${paneStorageId(machineId, paneId)}`;
}

function rememberedView(machineId: string, paneId: string): PaneView | null {
  try {
    const stored = window.localStorage.getItem(viewKey(machineId, paneId));
    if (stored === "chat" || stored === "terminal") return stored;
  } catch {}
  return null;
}

export function rememberView(machineId: string, paneId: string, view: PaneView): void {
  try { window.localStorage.setItem(viewKey(machineId, paneId), view); } catch {}
}

function prefersChatOnTouch(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

export function storedView(paneId: string, machineId: string, hasAgent: boolean | null, terminalAttach: boolean, defaultView: DefaultView): PaneView {
  if (!terminalAttach) return "chat";
  const remembered = rememberedView(machineId, paneId);
  if (remembered) return remembered;
  const agentLikely = hasAgent !== false;
  if (defaultView === "chat") return agentLikely ? "chat" : "terminal";
  if (defaultView === "terminal") return "terminal";
  return agentLikely && prefersChatOnTouch() ? "chat" : "terminal";
}
