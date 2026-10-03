import { create } from "zustand";

import type { AccessRefusal, ClientRole, HealthAuth } from "../../shared/protocol.ts";
import type { Machine } from "../../shared/machines.ts";
import type { HealthInfo } from "../lib/api.ts";
import type { PaneView } from "../lib/actions.ts";
import { notificationState, type NotificationState } from "../lib/notifications.ts";
import { initialMachineId, initialPaneId } from "./persistence.ts";

export interface ConnectionSlice {
  locked: boolean | null;
  lockReason: AccessRefusal | null;
  auth: HealthAuth | null;
  health: HealthInfo | null;
  error: string | null;
  connected: boolean;
  outputStopped: boolean;
  role: ClientRole;
}

export interface MachinesSlice {
  machines: Machine[];
}

export interface SelectionSlice {
  selectedMachineId: string;
  selectedPaneId: string | null;
  autoSelected: boolean;
  view: PaneView;
  changesOpen: boolean;
}

export interface UiSlice {
  drawerOpen: boolean;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  filesOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;
  newSessionMachineId: string;
  machineDialog: Machine | "new" | null;
  updateRemote: boolean;
}

export interface AlertsSlice {
  notifications: NotificationState;
  pushOn: boolean;
}

export type AppState = ConnectionSlice & MachinesSlice & SelectionSlice & UiSlice & AlertsSlice;

const initialConnection = (): ConnectionSlice => ({
  locked: null,
  lockReason: null,
  auth: null,
  health: null,
  error: null,
  connected: false,
  outputStopped: false,
  role: "interact",
});

const initialSelection = (): SelectionSlice => ({
  selectedMachineId: initialMachineId(),
  selectedPaneId: initialPaneId(),
  autoSelected: false,
  view: "terminal",
  changesOpen: false,
});

const initialUi = (): UiSlice => ({
  drawerOpen: false,
  sidebarCollapsed: false,
  paletteOpen: false,
  filesOpen: false,
  settingsOpen: false,
  newSessionOpen: false,
  newSessionMachineId: "local",
  machineDialog: null,
  updateRemote: false,
});

const initialAlerts = (): AlertsSlice => ({
  notifications: notificationState(),
  pushOn: false,
});

export const useAppStore = create<AppState>()(() => ({
  ...initialConnection(),
  machines: [],
  ...initialSelection(),
  ...initialUi(),
  ...initialAlerts(),
}));

export const getApp = useAppStore.getState;
export const setApp = useAppStore.setState;
