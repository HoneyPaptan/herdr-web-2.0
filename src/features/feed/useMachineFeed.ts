import { useCallback, useEffect, useRef, useState } from "react";

import type { MachineEvent } from "../../../shared/machines.ts";
import type { HealthAuth } from "../../../shared/protocol.ts";
import { authenticate, pairDevice } from "../../lib/api.ts";
import { takeAuthTokenFromUrl } from "../../lib/authLink.ts";
import { deviceLabel } from "../../lib/phone.ts";
import { getApp } from "../../store/appStore.ts";
import { applyMachinePaneStatus, receiveMachines } from "../../store/machines.ts";
import { createPaneAlerts, type AlertSettings, type PaneAlerts } from "../alerts/paneAlerts.ts";
import { loadHealth, loadMachines, snapshotRequests, unlock } from "./sync.ts";

const POLL_MS = 5000;
const REFETCH_DEBOUNCE_MS = 500;

function isUnlocked(): boolean {
  return getApp().locked !== true;
}

function pollTick(): void {
  if (document.visibilityState === "hidden") return;
  void loadHealth();
  if (isUnlocked()) void loadMachines();
}

async function consumeAuthLink(): Promise<void> {
  const token = takeAuthTokenFromUrl();
  if (token !== null) await authenticate(token).catch(() => undefined);
}

function usePolling(): void {
  useEffect(() => {
    let timer = 0;
    let disposed = false;
    void consumeAuthLink().then(() => {
      if (disposed) return;
      pollTick();
      timer = window.setInterval(pollTick, POLL_MS);
    });
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && !disposed) pollTick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

function useAuthLinkWhileOpen(): void {
  useEffect(() => {
    const onHashChange = (): void => {
      const token = takeAuthTokenFromUrl();
      if (token === null) return;
      void authenticate(token).then(unlock).catch(() => undefined);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
}

function useDebouncedRefetch(): () => void {
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (isUnlocked()) void loadMachines();
    }, REFETCH_DEBOUNCE_MS);
  }, []);
}

function routeMachineEvent(payload: MachineEvent, alerts: PaneAlerts, refetch: () => void): void {
  snapshotRequests.invalidate();
  if (payload.type === "machines") {
    alerts.seed(payload.machines);
    receiveMachines(payload.machines);
    return;
  }
  const machine = getApp().machines.find((m) => m.id === payload.machine_id);
  if (!machine) return;
  const message = payload.message;
  if (message.type === "pane-status") {
    alerts.paneStatus(machine, message.pane_id, message.agent_status);
    applyMachinePaneStatus(machine.id, message.pane_id, message.agent_status, message.background_tasks);
  }
  if (message.type === "pane-exited") alerts.paneExited(machine, message.pane_id);
  if (message.type === "session-changed" || message.type === "pane-exited") refetch();
}

function useMachineEvents(locked: boolean | null, readAlertSettings: () => AlertSettings): void {
  const [alerts] = useState(() => createPaneAlerts(readAlertSettings));
  const refetch = useDebouncedRefetch();
  useEffect(() => {
    if (locked !== false) return;
    const events = new EventSource("/api/machines/events");
    events.onmessage = (event) => {
      let payload: MachineEvent;
      try { payload = JSON.parse(event.data); } catch { return; }
      routeMachineEvent(payload, alerts, refetch);
    };
    return () => events.close();
  }, [locked, alerts, refetch]);
}

function usePairFromAddress(locked: boolean | null, pairCode: string, auth: HealthAuth | null): void {
  const paired = useRef(false);
  useEffect(() => {
    if (locked !== false || pairCode === "" || paired.current || auth?.via === "device") return;
    paired.current = true;
    pairDevice(pairCode, deviceLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0)).then(loadHealth).catch(() => undefined);
  }, [locked, pairCode, auth]);
}

export function useMachineFeed(options: { locked: boolean | null; auth: HealthAuth | null; pairCode: string; readAlertSettings: () => AlertSettings }): void {
  usePolling();
  useAuthLinkWhileOpen();
  useMachineEvents(options.locked, options.readAlertSettings);
  usePairFromAddress(options.locked, options.pairCode, options.auth);
}
