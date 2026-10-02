import type { AgentStatus } from "../../shared/protocol.ts";
import { cn } from "@/lib/utils";
import { useT } from "../lib/i18n.ts";
import { knownStatus, STATUS_WORD, type KnownStatus } from "../lib/status.ts";
import { Orb } from "./Orb.tsx";

const RAIL_MARK: Partial<Record<KnownStatus, string>> = { blocked: "bg-accent-command", done: "bg-accent-add" };
const MARK = "h-1.5 w-0.5 rounded-[1px]";

function RailMark({ value }: { value: KnownStatus }) {
  const t = useT();
  const color = RAIL_MARK[value];
  return color ? <span role="img" aria-label={t(STATUS_WORD[value])} className={cn(MARK, color)} /> : null;
}

export function StatusRail({ status }: { status?: AgentStatus }) {
  const value = knownStatus(status);
  return (
    <span className="badge flex w-2 shrink-0 items-center self-stretch" data-status={value}>
      <RailMark value={value} />
    </span>
  );
}

export function WorkingOrb({ status }: { status?: AgentStatus }) {
  const t = useT();
  if (knownStatus(status) !== "working") return null;
  return <Orb state="listening" role="img" aria-label={t(STATUS_WORD.working)} className="shrink-0" />;
}

export function StatusMark({ status }: { status?: AgentStatus }) {
  const t = useT();
  const value = knownStatus(status);
  if (value === "working") return <span className="badge inline-flex shrink-0 items-center" data-status={value}><WorkingOrb status={status} /></span>;
  if (RAIL_MARK[value]) return <span className="badge inline-flex h-5 w-2 shrink-0 items-center justify-center" data-status={value}><RailMark value={value} /></span>;
  return <span className="badge sr-only" data-status={value}>{t(STATUS_WORD[value])}</span>;
}
