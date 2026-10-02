import type { AgentStatus } from "../../shared/protocol.ts";
import type { Machine } from "../../shared/machines.ts";
import { applyPaneStatus } from "../lib/snapshot.ts";
import { keepIfSame } from "../lib/sameData.ts";
import { getApp, setApp } from "./appStore.ts";

export function receiveMachines(machines: Machine[]): void {
  setApp({ machines: keepIfSame(getApp().machines, machines) });
}

export function applyMachinePaneStatus(machineId: string, paneId: string, status: AgentStatus, backgroundTasks?: number): void {
  const list = getApp().machines;
  let changed = false;
  const next = list.map((machine) => {
    if (machine.id !== machineId || !machine.snapshot) return machine;
    const snapshot = applyPaneStatus(machine.snapshot, paneId, status, backgroundTasks);
    if (snapshot === machine.snapshot) return machine;
    changed = true;
    return { ...machine, snapshot };
  });
  if (changed) setApp({ machines: next });
}
