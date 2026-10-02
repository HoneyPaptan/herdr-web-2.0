import { ApiError, fetchBridgeHealth, fetchHealth, fetchMachines, signOut } from "../../lib/api.ts";
import { removePushSubscription } from "../../lib/push.ts";
import { SnapshotRequests } from "../../lib/snapshotRequests.ts";
import { setApp } from "../../store/appStore.ts";
import { receiveAuth, receiveHealth } from "../../store/connection.ts";
import { receiveMachines } from "../../store/machines.ts";

export const snapshotRequests = new SnapshotRequests();

export async function loadHealth(): Promise<void> {
  try { receiveAuth((await fetchBridgeHealth()).auth); } catch {}
  try { receiveHealth(await fetchHealth()); } catch { receiveHealth(null); }
}

export async function loadMachines(): Promise<void> {
  try {
    await snapshotRequests.read(fetchMachines, (machines) => {
      receiveMachines(machines);
      setApp({ error: null, locked: false });
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { setApp({ locked: true }); return; }
    setApp({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function unlock(): void {
  setApp({ locked: false });
  void loadHealth();
  void loadMachines();
}

export async function signOutDevice(): Promise<void> {
  setApp({ drawerOpen: false });
  await removePushSubscription().catch(() => undefined);
  setApp({ pushOn: false });
  try { await signOut(); } catch {}
  await loadHealth();
}
