import type { ClientRole, HealthAuth, ServerMessage } from "../../shared/protocol.ts";
import type { HealthInfo } from "../lib/api.ts";
import { keepIfSame } from "../lib/sameData.ts";
import { getApp, setApp } from "./appStore.ts";

export function receiveAuth(auth: HealthAuth): void {
  setApp({
    locked: auth.required && !auth.authenticated,
    lockReason: auth.reason ?? null,
    auth: keepIfSame(getApp().auth, auth),
  });
}

export function receiveHealth(health: HealthInfo | null): void {
  setApp({ health: keepIfSame(getApp().health, health) });
}

export function setConnection(connected: boolean): void {
  setApp(connected ? { connected, outputStopped: false } : { connected });
}

export function setRole(role: ClientRole): void {
  setApp({ role });
}

export function handleServerMessage(message: ServerMessage): void {
  if (message.type === "error" && message.code === "output_stalled") setApp({ outputStopped: true });
}
