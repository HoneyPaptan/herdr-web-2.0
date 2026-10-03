import type { AgentStatus } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import { knownStatus, STATUS_WORD } from "../lib/status.ts";
import { Orb } from "./Orb.tsx";

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
  if (knownStatus(status) !== "working") return null;
  return <Orb state="listening" role="img" aria-label={t(STATUS_WORD.working)} className="shrink-0" />;
}

export function StatusMark({ status }: { status?: AgentStatus }) {
  const t = useT();
  const value = knownStatus(status);
  if (value === "blocked") return <span className="badge inline-flex h-5 w-2 shrink-0 items-center justify-center" data-status={value}><WaitingMark /></span>;
  if (value === "unknown") return <span className="badge sr-only" data-status={value}>{t(STATUS_WORD[value])}</span>;
  return <span className="badge inline-flex shrink-0 items-center" data-status={value}><StatusOrb status={status} /></span>;
}
