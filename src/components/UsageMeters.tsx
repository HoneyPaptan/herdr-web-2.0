import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Clock, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProviderUsage, UsageWindow } from "../../shared/protocol.ts";
import { useT, type Translate } from "../lib/i18n.ts";
import { useSettings, type UsageCount } from "../lib/settings.ts";
import { formatPercent, formatResetIn, HIGH_PERCENT, meterPercent, meterText, orderProviders, PROVIDER_MARK, PROVIDER_NAME, tightestWindow, usageName, useUsage, windowLabel, formatResetAt, formatResetShort, leftLevel, type LeftLevel } from "../lib/usage.ts";
import { AgentMark } from "./AgentMark.tsx";

const MAX_CHIPS = 4;
const VALUE_TONE: Record<LeftLevel, string> = { ok: "text-foreground", mid: "text-accent-command", low: "text-destructive" };
const FILL_TONE: Record<LeftLevel, string> = { ok: "bg-primary", mid: "bg-accent-command", low: "bg-destructive" };
const PLAN_CHIP = "shrink-0 whitespace-nowrap rounded-sm bg-muted px-1 text-ui leading-tight text-muted-foreground";

function isHigh(window: UsageWindow | null): boolean {
  return window !== null && window.used_percent >= HIGH_PERCENT;
}

function valueTone(window: UsageWindow | null): string | undefined {
  return window ? VALUE_TONE[leftLevel(window)] : undefined;
}

function problemText(t: Translate, usage: ProviderUsage): string | null {
  const name = PROVIDER_NAME[usage.id];
  return usage.problem === "expired" ? t("Sign-in expired. Open {name} to renew it.", { name })
    : usage.problem === "rate_limited" ? t("{name} asked to slow down. These are the last numbers.", { name })
    : usage.problem === "failed" ? t("{name} could not be reached.", { name })
    : usage.problem === "locked" ? t("The server cannot open the keychain holding this sign-in.")
    : null;
}

function isError(usage: ProviderUsage): boolean {
  return usage.problem === "expired" || usage.problem === "failed";
}

function Meter({ window, value, className, label, valueText }: { window: UsageWindow | null; value: number; className?: string; label?: string; valueText?: string }) {
  const named = label !== undefined;
  return (
    <span
      className={cn("block h-1 overflow-hidden rounded-full bg-foreground/20", className)}
      role={named ? "meter" : undefined}
      aria-hidden={named ? undefined : true}
      aria-label={label}
      aria-valuemin={named ? 0 : undefined}
      aria-valuemax={named ? 100 : undefined}
      aria-valuenow={named ? value : undefined}
      aria-valuetext={valueText}
    >
      <span className={cn("block h-full rounded-full transition-[width] duration-300", window ? FILL_TONE[leftLevel(window)] : "bg-primary")} style={{ width: value > 0 ? `max(4px, ${value}%)` : 0 }} />
    </span>
  );
}

function DetailHead({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  const t = useT();
  return (
    <div className="flex min-h-6 items-center justify-between text-ui text-muted-foreground/70">
      <span>{t("Subscription usage")}</span>
      <Button variant="ghost" size="icon-xs" className="cursor-pointer text-muted-foreground" aria-label={t("Refresh")} aria-busy={loading} onClick={() => { if (!loading) onRefresh(); }}>
        <RefreshCw aria-hidden="true" className={cn(loading && "animate-spin")} />
      </Button>
    </div>
  );
}

function Chip({ usage, count }: { usage: ProviderUsage; count: UsageCount }) {
  const window = tightestWindow(usage);
  const value = window ? meterPercent(window, count) : 0;
  return (
    <span className={cn("usage-chip flex shrink-0 items-center gap-1 tabular-nums", isHigh(window) && "is-high", usage.problem && "opacity-60")}>
      <AgentMark agent={PROVIDER_MARK[usage.id]} size={14} />
      <span className={valueTone(window)}>{window ? formatPercent(value) : "?"}</span>
      <Meter window={window} value={value} className="w-4" />
    </span>
  );
}

function Provider({ usage, now, count, problemShown = false }: { usage: ProviderUsage; now: number; count: UsageCount; problemShown?: boolean }) {
  const t = useT();
  const problem = problemText(t, usage);
  return (
    <section className="usage-provider flex flex-col gap-2" aria-label={usageName(usage)}>
      <div className="flex min-w-0 items-center gap-1.5 text-ui">
        <AgentMark agent={PROVIDER_MARK[usage.id]} size={14} />
        <span className="shrink-0 text-foreground">{PROVIDER_NAME[usage.id]}</span>
        {usage.plan && <span className={PLAN_CHIP}>{usage.plan}</span>}
        {usage.account && <span className="usage-account ml-auto min-w-0 truncate text-muted-foreground/60">{usage.account}</span>}
      </div>
      {problem && !problemShown && <p className={cn("usage-note m-0 text-ui", isError(usage) ? "is-problem text-destructive" : "text-muted-foreground/60")}>{problem}</p>}
      {usage.windows.map((window, index) => {
        const reset = formatResetIn(window.resets_at, now);
        const value = meterPercent(window, count);
        return (
          <div key={index} className={cn("usage-row flex flex-col gap-1", isHigh(window) && "is-high")}>
            <p className="m-0 flex items-baseline gap-3 text-ui text-muted-foreground">
              <span className="truncate">{windowLabel(window)}</span>
              {reset && <span className="ml-auto truncate text-muted-foreground/60">{t("Resets in {time}", { time: reset })}</span>}
              <span className={cn("shrink-0 tabular-nums", !reset && "ml-auto", valueTone(window))}>{meterText(window, count)}</span>
            </p>
            <Meter window={window} value={value} label={windowLabel(window)} valueText={meterText(window, count)} />
          </div>
        );
      })}
      {usage.windows.length === 0 && !problem && <p className="usage-note m-0 text-ui text-muted-foreground/60">{t("No limits reported")}</p>}
    </section>
  );
}

export function UsageMeters() {
  const t = useT();
  const { settings } = useSettings();
  const footer = settings.showUsage && settings.usagePlacement === "footer";
  const { report, loading, refresh } = useUsage(footer);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (!footer) setOpen(false); }, [footer]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      clearInterval(tick);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    setOpen(false);
    stripRef.current?.focus();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  const count = settings.usageCount;
  const shown = report ? orderProviders(report.providers, settings.usageOrder).filter((usage) => !settings.usageHidden.includes(usage.key)) : [];
  if (!footer || shown.length === 0) return null;
  const folded = shown.length > MAX_CHIPS ? shown.length - (MAX_CHIPS - 1) : 0;
  const chips = folded > 0 ? shown.slice(0, MAX_CHIPS - 1) : shown;
  const summary = shown.map((usage) => {
    const window = tightestWindow(usage);
    return `${usageName(usage)} ${window ? meterText(window, count) : "?"}`;
  }).join(", ");

  return (
    <div className="usage min-w-0 shrink" ref={rootRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={stripRef}
        type="button"
        className="usage-strip flex h-7 max-w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg border-0 bg-transparent px-1.5 text-ui text-muted-foreground transition-colors outline-none [font:inherit] hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent/50"
        aria-expanded={open}
        aria-label={`${t("Subscription usage")}: ${summary}`}
        onClick={() => setOpen(!open)}
      >
        {chips.map((usage) => <Chip key={usage.key} usage={usage} count={count} />)}
        {folded > 0 && <span className="usage-more shrink-0 text-muted-foreground/60">+{folded}</span>}
      </button>
      {open && (
        <div className="usage-popover absolute right-3 bottom-[calc(100%-0.25rem)] left-3 z-50 flex max-h-[calc(var(--app-height,100dvh)-160px)] flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover px-3 pt-2 pb-3 text-popover-foreground shadow-lg backdrop-blur-xl" role="dialog" aria-label={t("Subscription usage")}>
          <DetailHead loading={loading} onRefresh={refresh} />
          {shown.map((usage) => <Provider key={usage.key} usage={usage} now={now} count={count} />)}
        </div>
      )}
    </div>
  );
}

export function UsagePanel() {
  const t = useT();
  const { settings } = useSettings();
  const top = settings.showUsage && settings.usagePlacement === "top";
  const { report, loading, refresh } = useUsage(top);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const detailId = useId();
  useEffect(() => {
    if (!top) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, [top]);

  const count = settings.usageCount;
  const shown = report ? orderProviders(report.providers, settings.usageOrder).filter((usage) => !settings.usageHidden.includes(usage.key)) : [];
  if (!top || shown.length === 0) return null;
  return (
    <section className="usage-panel flex max-h-[40%] shrink-0 flex-col overflow-y-auto overscroll-contain px-2 pb-2" aria-label={t("Subscription usage")}>
      <button type="button" className="usage-panel-rows flex w-full cursor-pointer flex-col gap-3 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-ui text-sidebar-foreground/80 transition-colors outline-none [font:inherit] hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent/50" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => setOpen(!open)}>
        {shown.map((usage) => {
          const window = tightestWindow(usage);
          const value = window ? meterPercent(window, count) : 0;
          const reset = window ? formatResetShort(window.resets_at, now) : null;
          const resetAt = window && reset !== null ? formatResetAt(window.resets_at, now) : null;
          const problem = problemText(t, usage);
          const twin = shown.some((other) => other !== usage && other.id === usage.id);
          return (
            <span key={usage.key} className={cn("usage-panel-row flex flex-col gap-1", isHigh(window) && "is-high", usage.problem && "has-problem")}>
              <span className="flex min-w-0 items-center gap-1.5">
                <AgentMark agent={PROVIDER_MARK[usage.id]} size={14} />
                <span className="shrink-0 text-foreground">{PROVIDER_NAME[usage.id]}</span>
                {usage.plan && <span className={PLAN_CHIP}>{usage.plan}</span>}
                {twin && usage.account && <span className="usage-account min-w-0 truncate text-muted-foreground/60">{usage.account}</span>}
                <span className="ml-auto shrink-0 tabular-nums" aria-label={window ? meterText(window, count) : undefined}>
                  <span className={valueTone(window)}>{window ? formatPercent(value) : "?"}</span>
                  {window && <span className="text-muted-foreground/60"> {t(count === "left" ? "left" : "used")}</span>}
                </span>
              </span>
              <Meter window={window} value={value} />
              {window && (
                <span className="truncate text-muted-foreground/60">
                  {windowLabel(window)}{reset ? `, ${reset}` : ""}{resetAt ? ` (${resetAt})` : ""}
                </span>
              )}
              {problem && (
                <span className={cn("flex items-center gap-1", isError(usage) ? "is-problem text-destructive" : "text-muted-foreground/60")}>
                  {isError(usage) ? <TriangleAlert aria-hidden="true" className="size-3 shrink-0" /> : <Clock aria-hidden="true" className="size-3 shrink-0" />}
                  {problem}
                </span>
              )}
            </span>
          );
        })}
      </button>
      {open && (
        <div id={detailId} className="usage-panel-detail flex flex-col gap-3 px-2 pt-2">
          <DetailHead loading={loading} onRefresh={refresh} />
          {shown.map((usage) => <Provider key={usage.key} usage={usage} now={now} count={count} problemShown />)}
        </div>
      )}
    </section>
  );
}
