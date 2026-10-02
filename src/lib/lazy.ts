import { lazy, useEffect, useState, type ComponentType } from "react";

export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K) {
  let pending: Promise<M> | null = null;
  const preload = () => (pending ??= load());
  const Component = lazy(async () => ({ default: (await preload())[name] }));
  return Object.assign(Component, { preload });
}

export function preloadWhenIdle(...preloads: Array<() => Promise<unknown>>) {
  const run = () => { for (const preload of preloads) void preload().catch(() => undefined); };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 2000);
  return () => window.clearTimeout(id);
}

export function useOpenedOnce(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  useEffect(() => { if (open) setOpened(true); }, [open]);
  return opened || open;
}
