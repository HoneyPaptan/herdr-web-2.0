import { Bell as BellIcon, Copy, Ellipsis, FolderOpen, Lock, MessageSquare, PanelLeft, Search, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { HerdrPane } from "../../../shared/protocol.ts";
import { displayPaneTitle } from "../../components/Sidebar.tsx";
import { useT } from "../../lib/i18n.ts";
import { useAppStore } from "../../store/appStore.ts";
import { selectCanSignOut, selectSelectedMachine, selectSelectedPane, selectSelectedWorkspace, selectTargetHerdr, selectTerminalAttach } from "../../store/selectors.ts";
import { setView } from "../../store/selection.ts";
import { openFiles, openPalette, toggleDrawer, toggleSidebarCollapsed } from "../../store/ui.ts";
import { signOutDevice } from "../feed/sync.ts";
import type { Bell } from "../alerts/useNotifications.ts";
import { Brand } from "./Brand.tsx";

const CHROME_BUTTON = "shrink-0 opacity-80 transition-opacity hover:opacity-100 [&_svg]:size-4.5";
const MENU_ROW = "cursor-pointer text-ui";
const STATUS_CHIP = "inline-flex shrink-0 items-center gap-1.5 text-ui text-muted-foreground";
const STATUS_DOT = "size-1.5 shrink-0 rounded-full";

function DrawerToggle() {
  const t = useT();
  const drawerOpen = useAppStore((state) => state.drawerOpen);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("drawer-toggle", CHROME_BUTTON)}
      aria-label={t(drawerOpen ? "Close workspace list" : "Open workspace list")}
      aria-expanded={drawerOpen}
      aria-controls="workspace-drawer"
      onClick={toggleDrawer}
    >
      <PanelLeft />
    </Button>
  );
}

function SidebarToggle() {
  const t = useT();
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("header-desktop-only sidebar-toggle", CHROME_BUTTON)}
      aria-label={t(collapsed ? "Show workspace list" : "Hide workspace list")}
      aria-pressed={!collapsed}
      title={t("Toggle sidebar (⌘⇧B)")}
      onClick={toggleSidebarCollapsed}
    >
      <PanelLeft />
    </Button>
  );
}

function Crumb({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      <span className={cn("min-w-0 truncate", className)}>{children}</span>
      <span aria-hidden="true" className={cn("shrink-0 text-muted-foreground/50", className)}>/</span>
    </>
  );
}

function PaneContext({ pane, machineName }: { pane: HerdrPane; machineName: string }) {
  const workspace = useAppStore(selectSelectedWorkspace);
  const workspaceLabel = workspace?.label ?? pane.workspace_id;
  return (
    <div className="context flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-ui">
      <span className="context-sub flex max-w-[45%] min-w-0 shrink-0 items-center gap-1.5 text-muted-foreground">
        <Crumb className="machine-context-name max-md:hidden">{machineName}</Crumb>
        <Crumb>{workspaceLabel}</Crumb>
      </span>
      <span className="context-title min-w-0 truncate font-medium text-foreground">{displayPaneTitle(pane)}</span>
    </div>
  );
}

function ViewSwitch() {
  const t = useT();
  const view = useAppStore((state) => state.view);
  const terminalAttach = useAppStore(selectTerminalAttach);
  return (
    <div className="segmented view-switch shrink-0" role="group" aria-label="Pane view">
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
      <span role="status" className={cn("conn", connected ? "conn-live sr-only" : cn("conn-reconnecting", STATUS_CHIP))}>
        <span aria-hidden="true" className={cn(STATUS_DOT, "animate-pulse bg-(--status-working) motion-reduce:animate-none")} />
        <span className="conn-text max-[480px]:hidden">{t(connected ? "live" : outputStopped ? "disconnected" : "reconnecting")}</span>
      </span>
      {!herdr && (
        <span className={cn("pill-offline", STATUS_CHIP)}>
          <span aria-hidden="true" className={cn(STATUS_DOT, "bg-(--status-blocked)")} />
          <span className="max-[480px]:hidden">{t("herdr offline")}</span>
        </span>
      )}
    </>
  );
}

function MachineSummary({ machineName }: { machineName: string }) {
  const t = useT();
  const herdr = useAppStore(selectTargetHerdr);
  return (
    <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5 text-ui font-normal">
      <span className="truncate text-foreground">{machineName}</span>
      {herdr && <span className="truncate text-muted-foreground/60">{t("herdr {version} · protocol {protocol}", { version: herdr.version, protocol: herdr.protocol })}</span>}
    </DropdownMenuLabel>
  );
}

function MoreMenu({ bell, bellVisible, machineName }: { bell: Bell; bellVisible: boolean; machineName: string }) {
  const t = useT();
  const pane = useAppStore(selectSelectedPane);
  const canSignOut = useAppStore(selectCanSignOut);
  const cwd = pane?.cwd;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("header-more", CHROME_BUTTON)} aria-label={t("More actions")}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="w-[min(260px,calc(100vw-1rem))]">
        <MachineSummary machineName={machineName} />
        <DropdownMenuSeparator />
        {pane && (
          <DropdownMenuItem className={MENU_ROW} onSelect={openFiles}>
            <FolderOpen />
            {t("Browse files")}
          </DropdownMenuItem>
        )}
        {cwd && (
          <DropdownMenuItem className={MENU_ROW} onSelect={() => void navigator.clipboard?.writeText(cwd)}>
            <Copy />
            <span className="flex min-w-0 flex-col">
              {t("Copy folder path")}
              <span className="truncate text-muted-foreground/60">{cwd}</span>
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={MENU_ROW} onSelect={openPalette}>
          <Search />
          {t("Command palette")}
          <DropdownMenuShortcut className="max-md:hidden">⌘⇧K</DropdownMenuShortcut>
        </DropdownMenuItem>
        {bellVisible && (
          <DropdownMenuCheckboxItem className={cn("bell-button", MENU_ROW)} checked={bell.on} aria-label={bell.label} onCheckedChange={() => void bell.run()}>
            <BellIcon />
            {t("Alerts")}
          </DropdownMenuCheckboxItem>
        )}
        {canSignOut && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={MENU_ROW} onSelect={() => void signOutDevice()}>
              <Lock />
              {t("Sign out")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppHeader({ bell, bellVisible }: { bell: Bell; bellVisible: boolean }) {
  const pane = useAppStore(selectSelectedPane);
  const machineName = useAppStore((state) => selectSelectedMachine(state)?.name ?? state.selectedMachineId);
  return (
    <header className="app-header">
      <DrawerToggle />
      <SidebarToggle />
      {pane ? <PaneContext pane={pane} machineName={machineName} /> : <div className="flex min-w-0 flex-1 items-center gap-2"><Brand /></div>}
      <ConnectionStatus />
      {pane && <ViewSwitch />}
      <MoreMenu bell={bell} bellVisible={bellVisible} machineName={machineName} />
    </header>
  );
}
