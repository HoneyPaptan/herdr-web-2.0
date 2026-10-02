import type { Machine } from "../../shared/machines.ts";
import { getApp, setApp } from "./appStore.ts";

const PHONE_LAYOUT = "(max-width: 768px)";

export function setDrawerOpen(drawerOpen: boolean): void {
  setApp({ drawerOpen });
}

export function toggleDrawer(): void {
  setApp((state) => ({ drawerOpen: !state.drawerOpen }));
}

export function toggleSidebarCollapsed(): void {
  setApp((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
}

export function toggleSidebar(): void {
  if (window.matchMedia(PHONE_LAYOUT).matches) toggleDrawer();
  else toggleSidebarCollapsed();
}

export function openNewSession(machineId = getApp().selectedMachineId): void {
  setApp({ drawerOpen: false, newSessionMachineId: machineId, newSessionOpen: true });
}

export function closeNewSession(): void {
  setApp({ newSessionOpen: false });
}

export function openPalette(): void {
  setApp({ paletteOpen: true });
}

export function closePalette(): void {
  setApp({ paletteOpen: false });
}

export function openSettings(): void {
  setApp({ drawerOpen: false, settingsOpen: true });
}

export function closeSettings(): void {
  setApp({ settingsOpen: false });
}

export function openFiles(): void {
  setApp({ drawerOpen: false, filesOpen: true });
}

export function closeFiles(): void {
  setApp({ filesOpen: false });
}

export function openMachineDialog(machine: Machine | "new", updateRemote = false): void {
  setApp({ machineDialog: machine, updateRemote });
}

export function closeMachineDialog(): void {
  setApp({ machineDialog: null });
}
