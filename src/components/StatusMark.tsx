import type { AgentStatus } from "../../shared/protocol.ts";
import { cn } from "@/lib/utils";
import { useT } from "../lib/i18n.ts";
import { knownStatus, STATUS_WORD, type KnownStatus } from "../lib/status.ts";
import { Orb } from "./Orb.tsx";

const STILL_ORB: Partial<Record<KnownStatus, string>> = { idle: "opacity-40", done: "opacity-100" };

function WaitingMark() {
  const t = useT();
  return <span role="img" aria-label={t(STATUS_WORD.blocked)} className="h-1.5 w-0.5 rounded-[1px] bg-accent-command" />;
}

export function StatusRail({ status }: { status?: AgentStatus }) {
  const value = knownStatus(status);
  return (
    <span className="badge flex w-2 shrink-0 items-center self-stretch" data-status={value}>
      {value === "blocked" && <WaitingMark />}
    </span>
  );
}

export function StatusOrb({ status }: { status?: AgentStatus }) {
  const t = useT();
  const value = knownStatus(status);
  const still = STILL_ORB[value];
  if (value !== "working" && !still) return null;
  return <Orb state="listening" paused={value !== "working"} role="img" aria-label={t(STATUS_WORD[value])} className={cn("shrink-0", still)} />;
}

export function StatusMark({ status }: { status?: AgentStatus }) {
  const t = useT();
  const value = knownStatus(status);
  if (value === "blocked") return <span className="badge inline-flex h-5 w-2 shrink-0 items-center justify-center" data-status={value}><WaitingMark /></span>;
  if (value === "unknown") return <span className="badge sr-only" data-status={value}>{t(STATUS_WORD[value])}</span>;
  return <span className="badge inline-flex shrink-0 items-center" data-status={value}><StatusOrb status={status} /></span>;
}
