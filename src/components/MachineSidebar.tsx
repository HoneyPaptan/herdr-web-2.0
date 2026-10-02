import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, CircleDashed, Download, Ellipsis, Monitor, Plus, Search, Settings, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Machine, MachineState, MachineUpdate } from "../../shared/machines.ts";
import { MachineContext } from "../lib/machineContext.tsx";
import { answerMachineSetup, machineRequest } from "../lib/api.ts";
import { describeProgress } from "../lib/bridgeProgress.ts";
import type { AppActions } from "../lib/actions.ts";
import { useInstallPrompt } from "../lib/install.ts";
import { Sidebar } from "./Sidebar.tsx";
import { NeedsInput } from "./NeedsInput.tsx";
import { UsageMeters, UsagePanel } from "./UsageMeters.tsx";
import "./Machines.css";
import { useT } from "../lib/i18n.ts";
import { openPalette } from "../store/ui.ts";

declare const __APP_VERSION__: string;

export const STATE_WORD: Readonly<Record<MachineState, string>> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
  error: "Connection error",
};

interface Props { machines: Machine[]; selectedMachineId: string; selectedPaneId: string | null; actions: AppActions; version: string | null; onSelect(machineId: string, paneId: string | null): void; onNew(machineId: string): void; onAdd(): void; onSetup(machine: Machine, update?: boolean): void }
const SIDEBAR_ACTION = "w-full justify-start px-1.5 text-ui text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80 dark:hover:bg-sidebar-accent/50";
const KEYCAPS = "ml-auto text-muted-foreground/60 max-md:hidden";
const MENU_ROW = "cursor-pointer text-ui";

function SidebarActions({ target, onNew }: { target: Machine | undefined; onNew(): void }) {
  const t = useT();
  return <div className="flex shrink-0 flex-col gap-px px-2 pt-2 pb-1">
    <Button variant="ghost" size="sm" className={SIDEBAR_ACTION} disabled={target !== undefined && target.state !== "connected"} aria-label={target ? t("New session on {name}", { name: target.name }) : t("New session")} onClick={onNew}>
      <Plus />{t("New session")}<span className={KEYCAPS}>⌘⇧N</span>
    </Button>
    <Button variant="ghost" size="sm" className={SIDEBAR_ACTION} onClick={openPalette}>
      <Search />{t("Search")}<span className={KEYCAPS}>⌘⇧K</span>
    </Button>
  </div>;
}

function SidebarMore({ version, onAdd, onInstallHelp }: { version: string | null; onAdd(): void; onInstallHelp(): void }) {
  const t = useT();
  const { canInstall, installed, install } = useInstallPrompt();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-sm" className="sidebar-more shrink-0 opacity-80 transition-opacity hover:opacity-100" aria-label={t("More actions")}>
        <Ellipsis />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="end" sideOffset={4} className="w-[min(240px,calc(100vw-1rem))]">
      <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5 text-ui font-normal">
        <span className="truncate text-foreground">herdr web ui v{__APP_VERSION__}</span>
        <span className="truncate text-muted-foreground/60">{version ? `herdr ${version}` : t("herdr offline")}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem className={MENU_ROW} onSelect={onAdd}><Monitor />{t("Add PC")}</DropdownMenuItem>
      {!installed && <DropdownMenuItem className={MENU_ROW} onSelect={() => { if (canInstall) void install(); else onInstallHelp(); }}><Download />{t("Install app")}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function MachineSidebar(props: Props) {
  const t = useT();
  const { help } = useInstallPrompt();
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const target = props.machines.find((machine) => machine.id === props.selectedMachineId);
  return <div className="sidebar-shell">
    <SidebarActions target={target} onNew={props.actions.openNewSession} />
    <UsagePanel />
    <div className="machine-list" aria-label={t("PCs and workspaces")}>
      <NeedsInput machines={props.machines} selectedMachineId={props.selectedMachineId} selectedPaneId={props.selectedPaneId} onSelect={props.onSelect} />
      {props.machines.map((machine) => <MachineGroup key={machine.id} {...props} machine={machine} />)}
      {!props.machines.length && <p className="tree-state" role="status">{t("Loading PCs…")}</p>}
    </div>
    <footer className="sidebar-footer relative flex shrink-0 flex-col gap-1 border-t border-border px-2 pt-2 pb-[calc(--spacing(2)+env(safe-area-inset-bottom,0px))]">
      {installHelpOpen && <p className="px-1.5 text-ui text-muted-foreground/60" role="status">{help}</p>}
      <div className="sidebar-footer-row flex min-w-0 items-center gap-1">
        <Button variant="ghost" size="sm" className={cn("sidebar-footer-action min-w-0 flex-1", SIDEBAR_ACTION)} onClick={props.actions.openSettings}>
          <Settings />{t("Settings")}<span className={KEYCAPS}>⌘⇧,</span>
        </Button>
        <UsageMeters />
        <SidebarMore version={props.version} onAdd={props.onAdd} onInstallHelp={() => setInstallHelpOpen((open) => !open)} />
      </div>
    </footer>
  </div>;
}

function MachineGroup({ machine, ...props }: Props & { machine: Machine }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(`herdr-web-ui:pc-collapsed:${machine.id}`) === "1"; } catch { return false; } });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(machine.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = machine.state === "connected";
  const mutate = async (method: string, body?: unknown) => {
    try { await machineRequest(`/${machine.id}`, method, body); setError(null); if (method === "DELETE" && props.selectedMachineId === machine.id) props.onSelect("local", null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const actions: AppActions = { ...props.actions, selectPane: (id) => props.onSelect(machine.id, id), openNewSession: () => props.onNew(machine.id) };
  const toggle = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem(`herdr-web-ui:pc-collapsed:${machine.id}`, collapsed ? "0" : "1"); } catch {}
  };
  return <section className={`machine-group${props.selectedMachineId === machine.id ? " is-current" : ""}`} aria-label={t("PC {name}", { name: machine.name })}>
    <header className="machine-header">
      <button className="machine-toggle" aria-expanded={!collapsed} onClick={toggle}>
        {collapsed ? <ChevronRight className="machine-caret" aria-hidden="true" /> : <ChevronDown className="machine-caret" aria-hidden="true" />}
        <Monitor className="machine-icon" aria-hidden="true" />
        <span className="machine-name">{machine.name}</span>
        {machine.kind === "local" && <span className="machine-kind shrink-0 text-ui text-muted-foreground/60" title={t("The computer this app runs on")}>{t("Host")}</span>}
        {(machine.state === "connecting" || machine.state === "reconnecting") && <CircleDashed aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0 animate-spin text-muted-foreground [animation-duration:3s] motion-reduce:animate-none" />}
      </button>
      <button className="sidebar-row-action" disabled={!online} aria-label={t("New session on {name}", { name: machine.name })} title={t("New session")} onClick={() => props.onNew(machine.id)}><Plus aria-hidden="true" /></button>
      {machine.kind === "ssh" && <button className="sidebar-row-action" aria-label={t("Manage {name}", { name: machine.name })} title={t("Manage PC")} aria-expanded={editing} onClick={() => { setEditing(!editing); setConfirmDelete(false); }}><SlidersHorizontal aria-hidden="true" /></button>}
    </header>
    {machine.action_required || machine.updating ? <MachineActionNotice machine={machine} onSetup={props.onSetup} /> : <p className={`machine-state is-${machine.state}${online ? " visually-hidden" : ""}`} role="status" title={machine.error ?? undefined}>
      <span className="machine-state-word">{t(STATE_WORD[machine.state])}</span>
      {machine.error && <span className="machine-state-detail">{machine.error}</span>}
    </p>}
    {editing && <div className="machine-controls">
      <form onSubmit={(e) => { e.preventDefault(); void mutate("PATCH", { name }); }}><label className="field"><span className="field-label">{t("PC name")}</span><input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label><button className="btn" type="submit">{t("Rename")}</button></form>
      <div className="machine-control-buttons"><button className="btn" onClick={() => void mutate("PATCH", { enabled: !machine.enabled })}>{t(machine.enabled ? "Disconnect" : "Connect")}</button><button className="btn" onClick={() => props.onSetup(machine)}>{t("Reconnect / setup")}</button><button className="btn" onClick={() => props.onSetup(machine, true)}>{t("Update bridge…")}</button><button className="btn btn-danger" onClick={() => { if (confirmDelete) void mutate("DELETE"); else setConfirmDelete(true); }}>{t(confirmDelete ? "Confirm remove PC" : "Remove PC")}</button></div>
      {confirmDelete && <p className="field-hint">{t("Removes this registration. Remote sessions keep running.")}</p>}
    </div>}
    {error && <p className="machine-error" role="alert">{error}</p>}
    {!collapsed && <div className={online ? "" : "machine-offline"} inert={!online}>
      {!online && !machine.snapshot ? <p className="tree-state machine-empty" role="status">{t("No saved sessions")}</p> : <MachineContext.Provider value={machine.id}><Sidebar snapshot={machine.snapshot} selectedPaneId={props.selectedMachineId === machine.id ? props.selectedPaneId : null} actions={actions} /></MachineContext.Provider>}
    </div>}
  </section>;
}

function useStageSeconds(update: MachineUpdate): number {
  const key = `${update.job_id}:${update.progress?.stage ?? ""}`;
  const [start, setStart] = useState(() => ({ key, at: Date.now() - (update.progress?.elapsed_ms ?? 0) }));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (start.key !== key) setStart({ key, at: Date.now() - (update.progress?.elapsed_ms ?? 0) }); }, [key]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  return Math.max(0, Math.round((now - start.at) / 1000));
}

export function BridgeUpdateProgress({ update }: { update: MachineUpdate }) {
  const view = describeProgress(update.progress);
  const seconds = useStageSeconds(update);
  if (!view) return <p className="bridge-progress-step">{update.step}</p>;
  return <div className="bridge-progress">
    <p className="bridge-progress-step"><span>{view.label}</span><span className="bridge-progress-count">{view.step}</span></p>
    <div className="bridge-progress-bar" role="progressbar" aria-label={view.label} aria-valuemin={0} aria-valuemax={100} {...(view.percent === null ? {} : { "aria-valuenow": view.percent })}>
      <span className={view.percent === null ? "is-indeterminate" : ""} style={view.percent === null ? undefined : { width: `${view.percent}%` }} />
    </div>
    <p className="bridge-progress-detail">{view.detail ?? `${seconds} s`}</p>
  </div>;
}

function MachineActionNotice({ machine, onSetup }: { machine: Machine; onSetup(machine: Machine, update?: boolean): void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (request: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await request(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (machine.updating) {
    const updating = machine.updating;
    return <div className="machine-action is-updating" role="status">
      <p className="machine-action-text"><strong>{t("Updating the bridge")}</strong><span>{t("You can keep using the app; this PC reconnects when it is done.")}</span></p>
      <BridgeUpdateProgress update={updating} />
      <button type="button" className="btn" disabled={busy} onClick={() => void run(() => answerMachineSetup(updating.job_id, { action: "cancel" }))}>{t("Cancel update")}</button>
      {error && <p className="machine-error" role="alert">{error}</p>}
    </div>;
  }
  const update = machine.action_required === "update_bridge";
  return <div className="machine-action" role="alert">
    <p className="machine-action-text">
      <strong>{t(update ? "Bridge update needed" : "Setup needed")}</strong>
      <span>{t(update ? "This PC runs a bridge from a different version of herdr web ui. Update it to reconnect; herdr sessions keep running." : "Reconnecting needs your approval on this PC.")}</span>
      {update && machine.error && !/different version/.test(machine.error) && <span className="machine-action-reason">{machine.error}</span>}
    </p>
    {update ? <div className="machine-action-buttons">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => machineRequest(`/${encodeURIComponent(machine.id)}/update-bridge`, "POST"))}>{t("Update bridge")}</button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onSetup(machine, true)}>{t("Sign in and update…")}</button>
    </div> : <button type="button" className="btn btn-primary" onClick={() => onSetup(machine, false)}>{t("Set up…")}</button>}
    {error && <p className="machine-error" role="alert">{error}</p>}
  </div>;
}

export function MachineActionBanner({ machines, onSetup }: { machines: Machine[]; onSetup(machine: Machine, update?: boolean): void }) {
  const t = useT();
  const running = machines.find((machine) => machine.updating);
  if (running?.updating) {
    const view = describeProgress(running.updating.progress);
    return <div className="update-notice" role="status">
      <span>{t("Updating the bridge on {name}", { name: running.name })}{view ? ` · ${t(view.label)}${view.percent === null ? "" : ` ${view.percent}%`}` : "…"}</span>
    </div>;
  }
  const waiting = machines.filter((machine) => machine.action_required);
  const first = waiting[0];
  if (!first) return null;
  const update = first.action_required === "update_bridge";
  const others = waiting.length > 1 ? t(" (+{n} more)", { n: waiting.length - 1 }) : "";
  return <div className="update-notice" role="status">
    <span>{t(update ? "{name} needs a bridge update to reconnect{others}." : "{name} needs setup approval to reconnect{others}.", { name: first.name, others })}</span>
    <button type="button" className="btn" onClick={() => update ? void machineRequest(`/${encodeURIComponent(first.id)}/update-bridge`, "POST").catch(() => onSetup(first, true)) : onSetup(first, false)}>{t(update ? "Update bridge" : "Set up…")}</button>
  </div>;
}
