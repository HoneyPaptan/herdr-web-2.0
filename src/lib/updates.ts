import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateCommand, UpdateStatus } from "../../shared/update.ts";
import { fetchUpdateStatus, requestUpdate } from "./api.ts";
import { usePageVisible } from "./visibility.ts";

declare const __APP_REVISION__: string | null;

const ENTRY = /assets\/index-[\w-]+\.js/;

function loadedEntry(): string | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>("script[type=module][src]")) {
    const match = ENTRY.exec(script.src);
    if (match) return match[0];
  }
  return null;
}

async function servedEntry(): Promise<string | null> {
  const response = await fetch("/", { cache: "no-store" });
  return response.ok ? ENTRY.exec(await response.text())?.[0] ?? null : null;
}

function outdated(status: UpdateStatus | null, served: string | null): boolean {
  const loaded = loadedEntry();
  if (loaded && served) return loaded !== served;
  return typeof __APP_REVISION__ === "string" && !!status?.current_revision && __APP_REVISION__ !== status.current_revision;
}

export function useUpdates(enabled: boolean) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [served, setServed] = useState<string | null>(null);
  const mounted = useRef(false);
  const visible = usePageVisible();
  useEffect(() => {
    if (!enabled) { setStatus(null); setPending(false); setError(null); return; }
    if (!visible) return;
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function poll() {
      let delay = 2000;
      try {
        const [next, entry] = await Promise.all([fetchUpdateStatus(), servedEntry().catch(() => null)]);
        if (!stopped) {
          setStatus((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
          setServed(entry);
        }
        if (next.phase === "idle" && !next.available) delay = 30_000;
      } catch {}
      if (!stopped) timer = setTimeout(() => void poll(), delay);
    }
    void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); };
  }, [enabled, refresh, visible]);

  const request = useCallback(async (command: UpdateCommand) => {
    setPending(true); setError(null);
    try {
      await requestUpdate(command);
      if (mounted.current) {
        setStatus(previous => previous ? { ...previous, phase: "checking", error: null } : previous);
        setRefresh(value => value + 1);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally { if (mounted.current) setPending(false); }
  }, []);
  const busy = pending || status?.phase === "checking" || status?.phase === "building" || status?.phase === "restarting";
  const needsReload = outdated(status, served) && !busy;
  return { status, error, busy, needsReload, request };
}

export type UpdatesModel = ReturnType<typeof useUpdates>;
