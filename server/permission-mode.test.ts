import { describe, expect, it } from "bun:test";

import type { PermissionMode } from "../shared/permission-mode.ts";
import { findMode, hasPermissionModes, switchPermissionMode, type ModeKey, type ModePane } from "./permission-mode.ts";

const CLAUDE_FOOTERS: Record<string, string> = {
  manual: "  ⏸ manual mode on (shift+tab to cycle)",
  acceptEdits: "  ⏵⏵ accept edits on (shift+tab to cycle)",
  plan: "  ⏸ plan mode on (shift+tab to cycle)",
  auto: "  ⏵⏵ auto mode on (shift+tab to cycle)",
  yolo: "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
};
const GEMINI_FOOTERS: Record<string, string> = {
  manual: " Shift+Tab to accept edits",
  acceptEdits: " auto-accept edits Shift+Tab to plan",
  plan: " plan Shift+Tab to manual",
  yolo: " YOLO Ctrl+Y",
};
const APPROVAL = ["Bash command", "", "  curl -I https://example.com", "  Fetch HTTP headers.", "", "This command requires approval", "", "Do you want to proceed?", "❯ 1. Yes", "  2. No", "", "Esc to cancel · Tab to amend"].join("\n");

type FakeOptions = { footers?: Record<string, string>; deaf?: boolean; prompt?: boolean; ticking?: boolean; yolo?: (from: string) => string };

function fakePane(cycle: string[], options: FakeOptions = {}): { pane: ModePane; pressed: ModeKey[] } {
  const footers = options.footers ?? CLAUDE_FOOTERS;
  const pressed: ModeKey[] = [];
  let mode = cycle[0]!;
  let tick = 0;
  const pane: ModePane = {
    screen: async () => {
      tick += 1;
      const status = options.ticking ? `${footers[mode]} · ${tick}s` : footers[mode]!;
      return options.prompt ? APPROVAL : ["> fix the build", "", status].join("\n");
    },
    press: async (key) => {
      pressed.push(key);
      if (options.deaf) return;
      if (key === "ctrl+y") mode = options.yolo?.(mode) ?? mode;
      else mode = cycle[(cycle.indexOf(mode) + 1) % cycle.length]!;
    },
    wait: async () => {},
  };
  return { pane, pressed };
}

const CLAUDE_CYCLE = ["auto", "manual", "acceptEdits", "plan"];
const CLAUDE_YOLO_CYCLE = ["manual", "acceptEdits", "plan", "yolo", "auto"];

describe("switchPermissionMode for claude", () => {
  it("presses Shift+Tab until the footer shows the target", async () => {
    const { pane, pressed } = fakePane(CLAUDE_CYCLE);
    await switchPermissionMode(pane, "claude", "acceptEdits");
    expect(pressed).toEqual(["shift+tab", "shift+tab"]);
  });

  it("presses nothing when the mode is already on", async () => {
    const { pane, pressed } = fakePane(CLAUDE_CYCLE);
    await switchPermissionMode(pane, "claude", "auto");
    expect(pressed).toEqual([]);
  });

  it("reaches yolo when the session allows bypass permissions", async () => {
    const { pane, pressed } = fakePane(CLAUDE_YOLO_CYCLE);
    await switchPermissionMode(pane, "claude", "yolo");
    expect(pressed).toEqual(["shift+tab", "shift+tab", "shift+tab"]);
  });

  it("stops after one loop when yolo is not in the cycle", async () => {
    const { pane, pressed } = fakePane(CLAUDE_CYCLE);
    await expect(switchPermissionMode(pane, "claude", "yolo")).rejects.toThrow("not_reachable");
    expect(pressed).toHaveLength(4);
  });

  it("refuses while a permission prompt is open, since Shift+Tab could answer it", async () => {
    const { pane, pressed } = fakePane(CLAUDE_CYCLE, { prompt: true });
    await expect(switchPermissionMode(pane, "claude", "plan")).rejects.toThrow("prompt_open");
    expect(pressed).toEqual([]);
  });

  it("waits through a ticking status line for the mode itself to change", async () => {
    const { pane, pressed } = fakePane(CLAUDE_CYCLE, { ticking: true });
    await switchPermissionMode(pane, "claude", "plan");
    expect(pressed).toEqual(["shift+tab", "shift+tab", "shift+tab"]);
  });

  it("gives up after one press the session ignores", async () => {
    const { pane, pressed } = fakePane(CLAUDE_CYCLE, { deaf: true });
    await expect(switchPermissionMode(pane, "claude", "plan")).rejects.toThrow("no_response");
    expect(pressed).toEqual(["shift+tab"]);
  });

  it("refuses a mode the agent does not have", async () => {
    const { pane, pressed } = fakePane(CLAUDE_CYCLE);
    await expect(switchPermissionMode(pane, "claude", "dontAsk")).rejects.toThrow("not_listed");
    expect(pressed).toEqual([]);
  });
});

describe("switchPermissionMode for gemini", () => {
  const cycle = ["manual", "acceptEdits", "plan"];
  const yolo = (from: string) => from === "yolo" ? "manual" : "yolo";

  it("cycles approval modes with Shift+Tab", async () => {
    const { pane, pressed } = fakePane(cycle, { footers: GEMINI_FOOTERS });
    await switchPermissionMode(pane, "gemini", "plan");
    expect(pressed).toEqual(["shift+tab", "shift+tab"]);
  });

  it("toggles YOLO with Ctrl+Y, in and back out", async () => {
    const { pane, pressed } = fakePane(cycle, { footers: GEMINI_FOOTERS, yolo });
    await switchPermissionMode(pane, "gemini", "yolo");
    await switchPermissionMode(pane, "gemini", "manual");
    expect(pressed).toEqual(["ctrl+y", "ctrl+y"]);
  });
});

describe("findMode", () => {
  it("reads every claude footer and takes the lowest one on the screen", () => {
    for (const [mode, footer] of Object.entries(CLAUDE_FOOTERS)) expect(findMode(footer, "claude")?.id).toBe(mode as PermissionMode);
    expect(findMode("  ⏵⏵ don't ask on", "claude")?.id).toBe("dontAsk");
    const screen = [CLAUDE_FOOTERS.plan, "output", CLAUDE_FOOTERS.auto].join("\n");
    expect(findMode(screen, "claude")).toEqual({ id: "auto", line: 2 });
  });

  it("reads every gemini indicator, with or without plan mode in the cycle", () => {
    for (const [mode, footer] of Object.entries(GEMINI_FOOTERS)) expect(findMode(footer, "gemini")?.id).toBe(mode as PermissionMode);
    expect(findMode(" auto-accept edits Shift+Tab to manual", "gemini")?.id).toBe("acceptEdits");
    expect(findMode("we should plan the release", "gemini")).toBeNull();
  });

  it("knows which agents have permission modes", () => {
    expect(hasPermissionModes("claude")).toBe(true);
    expect(hasPermissionModes("gemini")).toBe(true);
    expect(hasPermissionModes("opencode")).toBe(false);
    expect(hasPermissionModes(null)).toBe(false);
  });
});
