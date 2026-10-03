import type { PermissionMode, PermissionModes } from "../shared/permission-mode.ts";
import { paneSendKeys } from "./herdr/client.ts";
import { PaneSwitchError, cycleTo, exclusive, herdrScreenPane, type ScreenPane, type Shown } from "./pane-switch.ts";
import { parseInteractivePrompt } from "./prompt.ts";

export type ModeKey = "shift+tab" | "ctrl+y";

export interface ModePane extends ScreenPane {
  press(key: ModeKey): Promise<void>;
}

interface ModeDriver {
  modes: PermissionMode[];
  read(line: string): PermissionMode | null;
  key(from: PermissionMode, to: PermissionMode): ModeKey;
}

const CLAUDE_FOOTER = /(?:⏸|⏵⏵) (manual mode|accept edits|plan mode|auto mode|bypass permissions|don't ask) on\b/;
const CLAUDE_LABELS: Record<string, PermissionMode> = {
  "manual mode": "manual",
  "accept edits": "acceptEdits",
  "plan mode": "plan",
  "auto mode": "auto",
  "bypass permissions": "yolo",
  "don't ask": "dontAsk",
};
const GEMINI_FOOTERS: [RegExp, PermissionMode][] = [
  [/\bauto-accept edits \S+ to (?:plan|manual)\b/, "acceptEdits"],
  [/\bplan \S+ to manual\b/, "plan"],
  [/\bYOLO \S+\+\S+/, "yolo"],
  [/\S+ to accept edits\b/, "manual"],
];

function readClaude(line: string): PermissionMode | null {
  const label = CLAUDE_FOOTER.exec(line)?.[1];
  return label ? CLAUDE_LABELS[label] ?? null : null;
}

function readGemini(line: string): PermissionMode | null {
  return GEMINI_FOOTERS.find(([footer]) => footer.test(line))?.[1] ?? null;
}

function geminiKey(from: PermissionMode, to: PermissionMode): ModeKey {
  return to === "yolo" || (from === "yolo" && to === "manual") ? "ctrl+y" : "shift+tab";
}

const DRIVERS: Record<string, ModeDriver> = {
  claude: { modes: ["manual", "acceptEdits", "plan", "auto", "yolo"], read: readClaude, key: () => "shift+tab" },
  gemini: { modes: ["manual", "acceptEdits", "plan", "yolo"], read: readGemini, key: geminiKey },
};

export function hasPermissionModes(agent: string | null): agent is string {
  return agent !== null && agent in DRIVERS;
}

function driverFor(agent: string): ModeDriver {
  const driver = DRIVERS[agent];
  if (!driver) throw new PaneSwitchError("not_listed");
  return driver;
}

export function findMode(screen: string, agent: string): Shown<PermissionMode> | null {
  const { read } = driverFor(agent);
  const lines = screen.split("\n");
  for (let line = lines.length - 1; line >= 0; line -= 1) {
    const id = read(lines[line]!);
    if (id) return { id, line };
  }
  return null;
}

async function refuseOpenPrompt(pane: ModePane, agent: string): Promise<string> {
  const screen = await pane.screen();
  if (parseInteractivePrompt(agent, screen) !== null) throw new PaneSwitchError("prompt_open");
  return screen;
}

export async function switchPermissionMode(pane: ModePane, agent: string, target: PermissionMode): Promise<void> {
  const driver = driverFor(agent);
  if (!driver.modes.includes(target)) throw new PaneSwitchError("not_listed");
  const screen = await refuseOpenPrompt(pane, agent);
  const find = (next: string) => findMode(next, agent);
  const from = find(screen);
  if (from === null) throw new PaneSwitchError("not_shown");
  const key = driver.key(from.id, target);
  await cycleTo(pane, screen, target, find, async () => {
    await refuseOpenPrompt(pane, agent);
    await pane.press(key);
  });
}

function herdrModePane(paneId: string): ModePane {
  return { ...herdrScreenPane(paneId), press: (key) => paneSendKeys(paneId, [key]) };
}

export async function panePermissionModes(paneId: string, agent: string): Promise<PermissionModes> {
  const driver = driverFor(agent);
  const screen = await herdrModePane(paneId).screen();
  return { current: findMode(screen, agent)?.id ?? null, modes: driver.modes };
}

export function switchPanePermissionMode(paneId: string, agent: string, target: PermissionMode): Promise<void> {
  return exclusive(paneId, () => switchPermissionMode(herdrModePane(paneId), agent, target));
}
