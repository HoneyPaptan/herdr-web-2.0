import type { PaneSwitchFailure } from "../shared/pane-switch.ts";
import { paneRead } from "./herdr/client.ts";

const POLL_MS = 80;
const SETTLE_MS = 1_500;
const MAX_PRESSES = 32;

export type Shown<Id extends string = string> = { id: Id; line: number };

export interface ScreenPane {
  screen(): Promise<string>;
  wait(ms: number): Promise<void>;
}

export class PaneSwitchError extends Error {
  constructor(readonly code: PaneSwitchFailure) { super(code); }
}

export function herdrScreenPane(paneId: string): ScreenPane {
  return {
    screen: async () => (await paneRead({ paneId, source: "visible", format: "text" })).text,
    wait: (ms) => Bun.sleep(ms),
  };
}

export async function settle(pane: ScreenPane, done: (screen: string) => boolean): Promise<string | null> {
  for (let waited = 0; waited <= SETTLE_MS; waited += POLL_MS) {
    const screen = await pane.screen();
    if (done(screen)) return screen;
    await pane.wait(POLL_MS);
  }
  return null;
}

function lineOf(screen: string, line: number): string {
  return screen.split("\n")[line] ?? "";
}

export async function cycleTo(
  pane: ScreenPane,
  screen: string,
  target: string,
  find: (screen: string) => Shown | null,
  press: () => Promise<void>,
): Promise<void> {
  const start = find(screen);
  if (start === null) throw new PaneSwitchError("not_shown");
  const seen = new Set([start.id]);
  let footer = lineOf(screen, start.line);
  let shown: string | null = start.id;
  const moved = (candidate: string): boolean => {
    if (lineOf(candidate, start.line) === footer) return false;
    const id = find(candidate)?.id ?? null;
    return id === null || id !== shown;
  };
  for (let presses = 0; shown !== target; presses += 1) {
    if (presses === MAX_PRESSES) throw new PaneSwitchError("not_reachable");
    await press();
    const next = await settle(pane, moved);
    if (next === null) throw new PaneSwitchError("no_response");
    footer = lineOf(next, start.line);
    shown = find(next)?.id ?? null;
    if (shown === null || shown === target) continue;
    if (seen.has(shown)) throw new PaneSwitchError("not_reachable");
    seen.add(shown);
  }
}

const busy = new Set<string>();

export async function exclusive<T>(paneId: string, run: () => Promise<T>): Promise<T> {
  if (busy.has(paneId)) throw new PaneSwitchError("busy");
  busy.add(paneId);
  try {
    return await run();
  } finally {
    busy.delete(paneId);
  }
}
