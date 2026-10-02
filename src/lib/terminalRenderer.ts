import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

import { adjustTerminalGlyphs } from "./terminalGlyphs.ts";

const loadWebgl = () => import("@xterm/addon-webgl").then((module) => module.WebglAddon);

function attachWebgl(term: Terminal, Addon: typeof WebglAddon, onLost: () => void): WebglAddon | null {
  try {
    const addon = new Addon();
    addon.onContextLoss(onLost);
    term.options.rescaleOverlappingGlyphs = true;
    term.loadAddon(addon);
    return addon;
  } catch {
    return null;
  }
}

function disposeQuietly(addon: WebglAddon | null): void {
  try {
    addon?.dispose();
  } catch {
    return;
  }
}

export function startTerminalRenderer(term: Terminal, gpu: boolean): () => void {
  let stopGlyphs: (() => void) | null = adjustTerminalGlyphs(term);
  let addon: WebglAddon | null = null;
  let stopped = false;

  const fallBackToDom = () => {
    disposeQuietly(addon);
    addon = null;
    if (!stopped && !stopGlyphs) stopGlyphs = adjustTerminalGlyphs(term);
  };

  if (gpu) {
    void loadWebgl().then((Addon) => {
      if (stopped) return;
      addon = attachWebgl(term, Addon, fallBackToDom);
      if (!addon) return;
      stopGlyphs?.();
      stopGlyphs = null;
    }, () => undefined);
  }

  return () => {
    stopped = true;
    stopGlyphs?.();
    stopGlyphs = null;
    disposeQuietly(addon);
    addon = null;
  };
}
