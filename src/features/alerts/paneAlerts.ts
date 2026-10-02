import type { AgentStatus, HerdrPane } from "../../../shared/protocol.ts";
import type { AlertPrefs } from "../../../shared/notify-policy.ts";
import { paneStorageId, type Machine } from "../../../shared/machines.ts";
import { displayPaneTitle } from "../../components/Sidebar.tsx";
import { dropletAllows, endedTurn, showDroplet, trackTurn, type DropletKind } from "../../lib/droplet.ts";
import { alertsAllow, shouldNotifyStatus, showPaneEndedNotification, showPaneStatusNotification } from "../../lib/notifications.ts";
import { getApp } from "../../store/appStore.ts";
import { findPane } from "../../store/selectors.ts";
import { selectTarget } from "../../store/selection.ts";

export interface AlertSettings {
  alerts: AlertPrefs;
  on: boolean;
  inApp: boolean;
}

function isPaneInFront(machineId: string, paneId: string): boolean {
  const state = getApp();
  return state.selectedMachineId === machineId && state.selectedPaneId === paneId && !state.drawerOpen;
}

function notificationLabel(machine: Machine, pane: HerdrPane): string {
  return `${machine.name} · ${displayPaneTitle(pane)}`;
}

function tabAlertsActive(settings: AlertSettings): boolean {
  return settings.on && !getApp().pushOn;
}

export function createPaneAlerts(readSettings: () => AlertSettings) {
  const statuses = new Map<string, AgentStatus>();
  const turnStarts = new Map<string, number>();
  const lastTurns = new Map<string, number>();

  const dropIn = (machine: Machine, pane: HerdrPane, kind: DropletKind): void => {
    const settings = readSettings();
    if (!settings.on || !settings.inApp || document.visibilityState !== "visible") return;
    if (isPaneInFront(machine.id, pane.pane_id)) return;
    showDroplet({
      machineId: machine.id,
      paneId: pane.pane_id,
      agent: pane.agent ?? null,
      title: displayPaneTitle(pane),
      machine: getApp().machines.length > 1 ? machine.name : null,
      kind,
    });
  };

  const openPane = (machine: Machine, paneId: string) => () => selectTarget(machine.id, paneId);

  return {
    seed(machines: Machine[]): void {
      for (const machine of machines) for (const pane of machine.snapshot?.panes ?? []) {
        statuses.set(paneStorageId(machine.id, pane.pane_id), pane.agent_status);
      }
    },

    paneStatus(machine: Machine, paneId: string, status: AgentStatus): void {
      const key = paneStorageId(machine.id, paneId);
      const previous = statuses.get(key);
      statuses.set(key, status);
      const worked = trackTurn(turnStarts, key, previous, status, Date.now());
      if (worked !== null) lastTurns.set(key, worked);
      const pane = findPane(machine, paneId);
      if (!pane || !shouldNotifyStatus(previous, status)) return;
      const settings = readSettings();
      if (dropletAllows(settings.alerts, status, worked)) dropIn(machine, pane, status === "blocked" ? "blocked" : "done");
      if (tabAlertsActive(settings) && alertsAllow(settings.alerts, status)) {
        showPaneStatusNotification(paneId, notificationLabel(machine, pane), status, openPane(machine, paneId), machine.id);
      }
    },

    paneExited(machine: Machine, paneId: string): void {
      const pane = findPane(machine, paneId);
      const worked = endedTurn(turnStarts, lastTurns, paneStorageId(machine.id, paneId), Date.now());
      if (!pane) return;
      const settings = readSettings();
      if (dropletAllows(settings.alerts, "done", worked)) dropIn(machine, pane, "ended");
      if (tabAlertsActive(settings) && settings.alerts.done !== "off") {
        showPaneEndedNotification(paneId, notificationLabel(machine, pane), openPane(machine, paneId), machine.id);
      }
    },
  };
}

export type PaneAlerts = ReturnType<typeof createPaneAlerts>;
