import type { AgentStatus } from "../../shared/protocol.ts";

export type KnownStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export const STATUS_WORD: Readonly<Record<KnownStatus, string>> = {
  idle: "Ready",
  working: "Working",
  blocked: "Waiting on you",
  done: "Finished",
  unknown: "Unknown",
};

const KNOWN: Readonly<Record<string, KnownStatus>> = { idle: "idle", working: "working", blocked: "blocked", done: "done" };

export function knownStatus(status?: AgentStatus): KnownStatus {
  return (status !== undefined && KNOWN[status]) || "unknown";
}

export function statusEdgeRead(previous: AgentStatus | undefined, next: AgentStatus | undefined): boolean {
  return previous !== next && (previous === "working" || next === "working");
}
