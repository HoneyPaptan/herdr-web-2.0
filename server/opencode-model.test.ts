import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OpencodeModelChoice } from "../shared/opencode-model.ts";
import { dialogShown, findShown, opencodePaths, opencodeRecentModels, switchOpencodeModel, type OpencodeKey, type OpencodePane } from "./opencode-model.ts";

const BUNNY: OpencodeModelChoice = { id: "opencode/space-bunny-free", name: "Space Bunny Free", provider: "OpenCode Zen" };
const PICKLE: OpencodeModelChoice = { id: "opencode/big-pickle", name: "Big Pickle", provider: "OpenCode Zen" };
const LUNA: OpencodeModelChoice = { id: "openrouter/~openai/gpt-luna-latest", name: "GPT Luna Latest", provider: "OpenRouter" };
const STRANGER: OpencodeModelChoice = { id: "other/stranger", name: "Stranger", provider: "Other" };
const LISTED = [BUNNY, PICKLE, LUNA];

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function footer(choice: OpencodeModelChoice): string {
  return `┃  Build · ${choice.name} ${choice.provider} · high`;
}

type FakeOptions = { dialog?: boolean; deaf?: boolean; stuck?: boolean; blank?: boolean };

function fakePane(cycle: OpencodeModelChoice[], options: FakeOptions = {}): { pane: OpencodePane; pressed: OpencodeKey[] } {
  const pressed: OpencodeKey[] = [];
  let index = 0;
  let dialog = options.dialog ?? false;
  const pane: OpencodePane = {
    screen: async () => ["  Big Pickle OpenCode Zen wrote the fix", dialog ? "┃  Select model                      esc" : "", "┃", options.blank ? "┃" : footer(cycle[index]!)].join("\n"),
    press: async (key) => {
      pressed.push(key);
      if (key === "esc" && !options.stuck) dialog = false;
      if (key === "f2" && !options.deaf) index = (index + 1) % cycle.length;
    },
    wait: async () => {},
  };
  return { pane, pressed };
}

describe("switchOpencodeModel", () => {
  it("presses F2 until the footer shows the target, with no Esc when no picker is open", async () => {
    const { pane, pressed } = fakePane(LISTED);
    await switchOpencodeModel(pane, LISTED, LUNA.id);
    expect(pressed).toEqual(["f2", "f2"]);
  });

  it("presses nothing when the target is already in use", async () => {
    const { pane, pressed } = fakePane(LISTED);
    await switchOpencodeModel(pane, LISTED, BUNNY.id);
    expect(pressed).toEqual([]);
  });

  it("closes an open picker with one Esc before cycling", async () => {
    const { pane, pressed } = fakePane(LISTED, { dialog: true });
    await switchOpencodeModel(pane, LISTED, PICKLE.id);
    expect(pressed).toEqual(["esc", "f2"]);
  });

  it("steps over a model the session knows but the list does not", async () => {
    const { pane, pressed } = fakePane([BUNNY, STRANGER, LUNA]);
    await switchOpencodeModel(pane, LISTED, LUNA.id);
    expect(pressed).toEqual(["f2", "f2"]);
  });

  it("stops after one full loop when the session never used the target", async () => {
    const { pane, pressed } = fakePane([BUNNY, PICKLE]);
    await expect(switchOpencodeModel(pane, LISTED, LUNA.id)).rejects.toThrow("not_reachable");
    expect(pressed).toEqual(["f2", "f2"]);
  });

  it("refuses a model outside the list without pressing anything", async () => {
    const { pane, pressed } = fakePane(LISTED);
    await expect(switchOpencodeModel(pane, LISTED, STRANGER.id)).rejects.toThrow("not_listed");
    expect(pressed).toEqual([]);
  });

  it("refuses to press blind when the footer is unreadable", async () => {
    const { pane, pressed } = fakePane(LISTED, { blank: true });
    await expect(switchOpencodeModel(pane, LISTED, LUNA.id)).rejects.toThrow("not_shown");
    expect(pressed).toEqual([]);
  });

  it("gives up after one F2 the session ignores", async () => {
    const { pane, pressed } = fakePane(LISTED, { deaf: true });
    await expect(switchOpencodeModel(pane, LISTED, LUNA.id)).rejects.toThrow("no_response");
    expect(pressed).toEqual(["f2"]);
  });

  it("sends only one Esc when the picker will not close", async () => {
    const { pane, pressed } = fakePane(LISTED, { dialog: true, stuck: true });
    await expect(switchOpencodeModel(pane, LISTED, LUNA.id)).rejects.toThrow("dialog_stuck");
    expect(pressed).toEqual(["esc"]);
  });
});

describe("findShown", () => {
  it("reads the model from the lowest footer line and needs the whole name", () => {
    const screen = ["┃  Build · Big Pickle OpenCode Zen", footer(LUNA)].join("\n");
    expect(findShown(screen, LISTED)).toEqual({ id: LUNA.id, line: 1 });
    expect(findShown("┃  Build · Big Pickle OpenCode Zenith", LISTED)).toBeNull();
    expect(findShown("┃  Build · Big Pickle OpenCode Zen", LISTED)?.id).toBe(PICKLE.id);
  });

  it("knows an open model or variant picker by its title", () => {
    expect(dialogShown("┃  Select variant          esc")).toBe(true);
    expect(dialogShown("Please select model names carefully")).toBe(false);
  });
});

describe("opencodeRecentModels", () => {
  it("lists the recent models once each, named from the catalog, ids when unnamed", async () => {
    const root = mkdtempSync(join(tmpdir(), "opencode-model-"));
    roots.push(root);
    const paths = { recent: join(root, "model.json"), catalog: join(root, "models.json") };
    writeFileSync(paths.recent, JSON.stringify({ recent: [
      { providerID: "opencode", modelID: "big-pickle" },
      { providerID: "opencode", modelID: "big-pickle" },
      { providerID: "local", modelID: "mystery" },
      { providerID: "", modelID: "broken" },
    ] }));
    writeFileSync(paths.catalog, JSON.stringify({ opencode: { name: "OpenCode Zen", models: { "big-pickle": { name: "Big Pickle" } } } }));
    expect(await opencodeRecentModels(paths)).toEqual([PICKLE, { id: "local/mystery", name: "mystery", provider: "local" }]);
  });

  it("answers an empty list when opencode has saved nothing", async () => {
    expect(await opencodeRecentModels({ recent: "/nonexistent/model.json", catalog: "/nonexistent/models.json" })).toEqual([]);
  });

  it("finds the files under the XDG folders, else under HOME", () => {
    expect(opencodePaths({ XDG_STATE_HOME: "/state", XDG_CACHE_HOME: "/cache", HOME: "/home/a" })).toEqual({ recent: "/state/opencode/model.json", catalog: "/cache/opencode/models.json" });
    expect(opencodePaths({ HOME: "/home/a" })).toEqual({ recent: "/home/a/.local/state/opencode/model.json", catalog: "/home/a/.cache/opencode/models.json" });
  });
});
