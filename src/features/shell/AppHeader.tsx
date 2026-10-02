import { Bell as BellIcon, FolderOpen, Lock, Menu, MessageSquare, PanelLeft, Search, SquareTerminal, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import type { HerdrPane } from "../../../shared/protocol.ts";
import { AgentMark } from "../../components/AgentMark.tsx";
import { displayPaneTitle } from "../../components/Sidebar.tsx";
import { useT } from "../../lib/i18n.ts";
import { useAppStore } from "../../store/appStore.ts";
import { selectCanSignOut, selectSelectedMachine, selectSelectedPane, selectSelectedWorkspace, selectTargetHerdr, selectTerminalAttach } from "../../store/selectors.ts";
import { setView } from "../../store/selection.ts";
import { openFiles, openPalette, toggleDrawer, toggleSidebarCollapsed } from "../../store/ui.ts";
import { signOutDevice } from "../feed/sync.ts";
import type { Bell } from "../alerts/useNotifications.ts";
import { Brand } from "./Brand.tsx";

function DrawerToggle() {
  const t = useT();
  const drawerOpen = useAppStore((state) => state.drawerOpen);
  return (
    <button
      type="button"
      className="icon-button drawer-toggle"
      aria-label={t(drawerOpen ? "Close workspace list" : "Open workspace list")}
      aria-expanded={drawerOpen}
      aria-controls="workspace-drawer"
      onClick={toggleDrawer}
    >
      {drawerOpen ? <X /> : <Menu />}
    </button>
  );
}

function SidebarToggle() {
  const t = useT();
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  return (
    <button
      type="button"
      className="icon-button header-desktop-only sidebar-toggle"
      aria-label={t(collapsed ? "Show workspace list" : "Hide workspace list")}
      aria-pressed={!collapsed}
      title={t("Toggle sidebar (⌘⇧B)")}
      onClick={toggleSidebarCollapsed}
    >
      <PanelLeft />
    </button>
  );
}

function PaneContext({ pane, machineName }: { pane: HerdrPane; machineName: string }) {
  const workspace = useAppStore(selectSelectedWorkspace);
  const title = displayPaneTitle(pane);
  const workspaceLabel = workspace?.label ?? pane.workspace_id;
  return (
    <div className="context" title={`${workspaceLabel} › ${title}`}>
      <div className="context-title">
        {pane.agent && <AgentMark agent={pane.agent} size={18} />}
        <span className="context-title-text">{title}</span>
      </div>
      <div className="context-sub">
        <span className="machine-context-name">{machineName}</span><span aria-hidden="true"> › </span>
        <span>{workspaceLabel}</span>
        {pane.cwd && (
          <>
            <span className="context-sep" aria-hidden="true">
              ›
            </span>
            <span>{pane.cwd}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ViewSwitch() {
  const t = useT();
  const view = useAppStore((state) => state.view);
  const terminalAttach = useAppStore(selectTerminalAttach);
  return (
    <div className="segmented view-switch" role="group" aria-label="Pane view">
      <button type="button" aria-pressed={view === "chat"} onClick={() => setView("chat")} title={t("Chat transcript (⌘⇧J)")}>
        <MessageSquare />
        <span className="header-desktop-only">{t("Chat")}</span>
      </button>
      <button type="button" aria-pressed={view === "terminal"} onClick={() => setView("terminal")} title={terminalAttach ? t("Live terminal (⌘⇧J)") : t("Live terminal: coming to Windows PCs once herdr can attach there")}>
        <SquareTerminal />
        <span className="header-desktop-only">{t("Terminal")}</span>
        {!terminalAttach && <span className="pill pill-soon">{t("soon")}</span>}
      </button>
    </div>
  );
}

function ConnectionStatus() {
  const t = useT();
  const { connected, outputStopped } = useAppStore(useShallow((state) => ({ connected: state.connected, outputStopped: state.outputStopped })));
  const herdr = useAppStore(selectTargetHerdr);
  return (
    <>
      <span
        className={`conn ${connected ? "conn-live" : "conn-reconnecting"}`}
        role="status"
        title={herdr ? t("herdr {version} · protocol {protocol}", { version: herdr.version, protocol: herdr.protocol }) : undefined}
      >
        <span className="conn-dot" aria-hidden="true" />
        <span className="conn-text">{t(connected ? "live" : outputStopped ? "disconnected" : "reconnecting")}</span>
      </span>
      {!herdr && <span className="pill pill-offline">{t("herdr offline")}</span>}
    </>
  );
}

function BellButton({ bell }: { bell: Bell }) {
  return (
    <button
      type="button"
      className={`icon-button bell-button${bell.on ? " is-on" : ""}`}
      aria-label={bell.label}
      aria-pressed={bell.on}
      title={bell.title}
      onClick={() => void bell.run()}
    >
      <BellIcon />
    </button>
  );
}

export function AppHeader({ bell, bellVisible }: { bell: Bell; bellVisible: boolean }) {
  const t = useT();
  const pane = useAppStore(selectSelectedPane);
  const machineName = useAppStore((state) => selectSelectedMachine(state)?.name ?? state.selectedMachineId);
  const canSignOut = useAppStore(selectCanSignOut);
  return (
    <header className="app-header">
      <DrawerToggle />
      <SidebarToggle />
      {pane ? <PaneContext pane={pane} machineName={machineName} /> : <><Brand /><span className="machine-context-name">{machineName}</span></>}
      {pane && <ViewSwitch />}
      <div className="header-meta">
        <ConnectionStatus />
        {pane && (
          <button type="button" className="icon-button files-button" aria-label={t("Browse files")} title={t("Browse files")} onClick={openFiles}>
            <FolderOpen />
          </button>
        )}
        <button type="button" className="icon-button" aria-label={t("Command palette")} title={t("Command palette (⌘⇧K)")} onClick={openPalette}>
          <Search />
        </button>
        {bellVisible && <BellButton bell={bell} />}
        {canSignOut && (
          <button type="button" className="icon-button lock-button header-desktop-only" aria-label={t("Sign out")} title={t("Sign out")} onClick={() => void signOutDevice()}>
            <Lock />
          </button>
        )}
      </div>
    </header>
  );
}
