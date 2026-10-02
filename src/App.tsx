import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { AccessGate } from "./components/AccessGate.tsx";
import { UpdateNotice } from "./components/UpdateControls.tsx";
import { OpenFileContext } from "./lib/filePaths.ts";
import { MachineContext } from "./lib/machineContext.tsx";
import { takePairCode } from "./lib/phone.ts";
import { useSettings } from "./lib/settings.ts";
import { useShortcuts } from "./lib/shortcuts.ts";
import { useUpdates } from "./lib/updates.ts";
import { useFileViewer } from "./lib/useFileViewer.ts";
import { useScreenWakeLock } from "./lib/wakeLock.ts";
import { watchDrawerSwipe } from "./lib/edgeSwipe.ts";
import { getApp, useAppStore } from "./store/appStore.ts";
import { selectHasSelectedPane } from "./store/selectors.ts";
import { openSettings, setDrawerOpen } from "./store/ui.ts";
import { useAlertSettingsReader, useNotifications } from "./features/alerts/useNotifications.ts";
import { AppDialogs } from "./features/dialogs/AppDialogs.tsx";
import { unlock } from "./features/feed/sync.ts";
import { useMachineFeed } from "./features/feed/useMachineFeed.ts";
import { useSelectionSync } from "./features/selection/useSelectionSync.ts";
import { AppHeader } from "./features/shell/AppHeader.tsx";
import { ConnectingShell } from "./features/shell/ConnectingShell.tsx";
import { MachineBanner, SidebarHost } from "./features/shell/SidebarHost.tsx";
import { TerminalHost } from "./features/shell/TerminalHost.tsx";
import { useAppActions } from "./features/shell/useAppActions.ts";

function useDrawerSwipe(): void {
  useEffect(() => watchDrawerSwipe(() => getApp().drawerOpen, setDrawerOpen), []);
}

function useViewFile(openFile: ReturnType<typeof useFileViewer>["openFile"]) {
  return useCallback((path: string) => {
    const { selectedPaneId, selectedMachineId } = getApp();
    openFile({ path, paneId: selectedPaneId, machineId: selectedMachineId });
  }, [openFile]);
}

export function App() {
  const { settings } = useSettings();
  const [pairCode] = useState(takePairCode);
  const { locked, lockReason, auth, machineId, sidebarCollapsed, hasPane } = useAppStore(useShallow((state) => ({
    locked: state.locked,
    lockReason: state.lockReason,
    auth: state.auth,
    machineId: state.selectedMachineId,
    sidebarCollapsed: state.sidebarCollapsed,
    hasPane: state.selectedPaneId !== null,
  })));
  const paneShown = useAppStore(selectHasSelectedPane);
  const alertSettings = useAlertSettingsReader();
  const { bell, bellVisible, enableNotifications } = useNotifications(alertSettings.alerts, alertSettings.alertsOn);
  const actions = useAppActions(bellVisible && !bell.on ? enableNotifications : null);
  const updates = useUpdates(locked === false);
  const fileViewer = useFileViewer();
  const viewFile = useViewFile(fileViewer.openFile);

  useMachineFeed({ locked, auth, pairCode, readAlertSettings: alertSettings.read });
  useDrawerSwipe();
  useSelectionSync();
  useScreenWakeLock(settings.keepScreenOn && locked === false && paneShown);
  useShortcuts(actions, locked === false);

  if (locked === null) return <ConnectingShell />;
  if (locked) return <AccessGate reason={lockReason} initialCode={pairCode} onUnlocked={unlock} />;

  return (
    <MachineContext.Provider value={machineId}>
      <div className={`app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <AppHeader bell={bell} bellVisible={bellVisible} />
        <UpdateNotice updates={updates} onOpen={openSettings} />
        <MachineBanner />
        <div className="app-body">
          <SidebarHost actions={actions} />
          <OpenFileContext.Provider value={hasPane ? viewFile : null}>
            <TerminalHost />
          </OpenFileContext.Provider>
        </div>
        <AppDialogs actions={actions} updates={updates} fileViewer={fileViewer} viewFile={viewFile} onEnableNotifications={enableNotifications} />
      </div>
    </MachineContext.Provider>
  );
}
