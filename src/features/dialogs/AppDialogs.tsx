import { Suspense, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { Droplet } from "../../components/Droplet.tsx";
import { MachineContext } from "../../lib/machineContext.tsx";
import type { AppActions } from "../../lib/actions.ts";
import type { useFileViewer } from "../../lib/useFileViewer.ts";
import type { useUpdates } from "../../lib/updates.ts";
import { lazyNamed, preloadWhenIdle, useOpenedOnce } from "../../lib/lazy.ts";
import { getApp, useAppStore } from "../../store/appStore.ts";
import { findPane, selectSelectedPane, selectSnapshot } from "../../store/selectors.ts";
import { selectTarget } from "../../store/selection.ts";
import { closeFiles, closeMachineDialog, closeNewSession, closePalette, closeSettings } from "../../store/ui.ts";
import { loadMachines } from "../feed/sync.ts";

const NewSessionDialog = lazyNamed(() => import("../../components/NewSessionDialog.tsx"), "NewSessionDialog");
const SettingsDialog = lazyNamed(() => import("../../components/SettingsDialog.tsx"), "SettingsDialog");
const CommandPalette = lazyNamed(() => import("../../components/CommandPalette.tsx"), "CommandPalette");
const MachineDialog = lazyNamed(() => import("../../components/MachineDialog.tsx"), "MachineDialog");
const FilesDialog = lazyNamed(() => import("../../components/FilesDialog.tsx"), "FilesDialog");
const FileViewer = lazyNamed(() => import("../../components/FileViewer.tsx"), "FileViewer");

type FileViewerState = ReturnType<typeof useFileViewer>;
type Updates = ReturnType<typeof useUpdates>;

function connectAndSelect(machineId: string, paneId: string | null): void {
  selectTarget(machineId, paneId);
  void loadMachines();
}

function NewSessionHost() {
  const { open, machineId, machineName, defaultCwd } = useAppStore(useShallow((state) => {
    const machineId = state.newSessionMachineId;
    return {
      open: state.newSessionOpen,
      machineId,
      machineName: state.machines.find((m) => m.id === machineId)?.name ?? machineId,
      defaultCwd: machineId === state.selectedMachineId ? selectSelectedPane(state)?.cwd ?? null : null,
    };
  }));
  const mounted = useOpenedOnce(open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <MachineContext.Provider value={machineId}>
        <NewSessionDialog
          key={machineId}
          machineName={machineName}
          open={open}
          defaultCwd={defaultCwd}
          onClose={closeNewSession}
          onCreated={(paneId) => {
            closeNewSession();
            connectAndSelect(machineId, paneId);
          }}
        />
      </MachineContext.Provider>
    </Suspense>
  );
}

function MachineDialogHost() {
  const { machine, updateRemote } = useAppStore(useShallow((state) => ({ machine: state.machineDialog, updateRemote: state.updateRemote })));
  if (!machine) return null;
  return (
    <Suspense fallback={null}>
      <MachineDialog
        updateRemote={updateRemote}
        machine={machine === "new" ? undefined : machine}
        onClose={closeMachineDialog}
        onConnected={(id) => {
          closeMachineDialog();
          connectAndSelect(id, null);
        }}
      />
    </Suspense>
  );
}

function openFromDroplet(machineId: string, paneId: string): void {
  const machine = getApp().machines.find((m) => m.id === machineId);
  if (!findPane(machine, paneId)) return;
  closeFiles();
  selectTarget(machineId, paneId);
}

function SettingsHost({ actions, updates, onEnableNotifications }: { actions: AppActions; updates: Updates; onEnableNotifications: () => Promise<boolean> }) {
  const open = useAppStore((state) => state.settingsOpen);
  const auth = useAppStore((state) => state.auth);
  const mounted = useOpenedOnce(open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <SettingsDialog auth={auth} open={open} onClose={closeSettings} actions={actions} updates={updates} onEnableNotifications={onEnableNotifications} />
    </Suspense>
  );
}

function FilesHost({ fileViewer, viewFile }: { fileViewer: FileViewerState; viewFile: (path: string) => void }) {
  const open = useAppStore((state) => state.filesOpen);
  const start = useAppStore((state) => {
    const pane = selectSelectedPane(state);
    return pane ? pane.foreground_cwd ?? pane.cwd ?? "" : null;
  });
  if (!open || start === null) return null;
  return (
    <Suspense fallback={null}>
      <FilesDialog start={start} viewing={fileViewer.viewing !== null} onOpenFile={viewFile} onClose={closeFiles} />
    </Suspense>
  );
}

function ViewerHost({ fileViewer }: { fileViewer: FileViewerState }) {
  const { viewing, openFile, closeFile } = fileViewer;
  if (viewing === null) return null;
  return (
    <MachineContext.Provider value={viewing.machineId}>
      <Suspense fallback={null}>
        <FileViewer key={viewing.path} path={viewing.path} paneId={viewing.paneId} onClose={closeFile} onOpen={(path) => openFile({ ...viewing, path })} />
      </Suspense>
    </MachineContext.Provider>
  );
}

function PaletteHost({ actions }: { actions: AppActions }) {
  const { open, machineId, paneId, view, snapshot } = useAppStore(useShallow((state) => ({
    open: state.paletteOpen,
    machineId: state.selectedMachineId,
    paneId: state.selectedPaneId,
    view: state.view,
    snapshot: selectSnapshot(state),
  })));
  const mounted = useOpenedOnce(open);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette key={machineId} open={open} onClose={closePalette} snapshot={snapshot} selectedPaneId={paneId} view={view} actions={actions} />
    </Suspense>
  );
}

export function AppDialogs(props: { actions: AppActions; updates: Updates; fileViewer: FileViewerState; viewFile: (path: string) => void; onEnableNotifications: () => Promise<boolean> }) {
  useEffect(() => preloadWhenIdle(SettingsDialog.preload, CommandPalette.preload, NewSessionDialog.preload, FilesDialog.preload, FileViewer.preload), []);
  return (
    <>
      <NewSessionHost />
      <MachineDialogHost />
      <Droplet onOpen={openFromDroplet} />
      <SettingsHost actions={props.actions} updates={props.updates} onEnableNotifications={props.onEnableNotifications} />
      <FilesHost fileViewer={props.fileViewer} viewFile={props.viewFile} />
      <ViewerHost fileViewer={props.fileViewer} />
      <PaletteHost actions={props.actions} />
    </>
  );
}
