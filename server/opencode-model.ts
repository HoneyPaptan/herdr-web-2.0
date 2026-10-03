import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { OpencodeModelChoice, OpencodeModels, OpencodeSwitchFailure } from "../shared/opencode-model.ts";
import { paneRead, paneSendKeys, paneSendText } from "./herdr/client.ts";

const POLL_MS = 80;
const SETTLE_MS = 1_500;
const MAX_PRESSES = 32;
const F2 = "\x1bOQ";
const DIALOG_TITLE = /^[\s│┃|]*Select (?:model|variant)\b/;
const NAME_CHAR = /[\p{L}\p{N}._-]/u;

type Row = Record<string, unknown>;
type Shown = { id: string; line: number };

export type OpencodeKey = "esc" | "f2";
export type OpencodePaths = { recent: string; catalog: string };

export interface OpencodePane {
  screen(): Promise<string>;
  press(key: OpencodeKey): Promise<void>;
  wait(ms: number): Promise<void>;
}

export class OpencodeSwitchError extends Error {
  constructor(readonly code: OpencodeSwitchFailure) { super(code); }
}

export function opencodePaths(env: Record<string, string | undefined> = process.env): OpencodePaths {
  const home = env["HOME"] ?? "";
  return {
    recent: join(env["XDG_STATE_HOME"] || join(home, ".local", "state"), "opencode", "model.json"),
    catalog: join(env["XDG_CACHE_HOME"] || join(home, ".cache"), "opencode", "models.json"),
  };
}

function record(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function readJson(path: string): Promise<Row> {
  try { return record(JSON.parse(await readFile(path, "utf8"))); } catch { return {}; }
}

let catalogCache: { path: string; mtimeMs: number; catalog: Row } | null = null;

async function readCatalog(path: string): Promise<Row> {
  const mtimeMs = await stat(path).then((info) => info.mtimeMs, () => -1);
  if (catalogCache?.path === path && catalogCache.mtimeMs === mtimeMs) return catalogCache.catalog;
  const catalog = mtimeMs < 0 ? {} : await readJson(path);
  catalogCache = { path, mtimeMs, catalog };
  return catalog;
}

function choiceOf(catalog: Row, providerID: string, modelID: string): OpencodeModelChoice {
  const provider = record(catalog[providerID]);
  const model = record(record(provider["models"])[modelID]);
  return { id: `${providerID}/${modelID}`, name: text(model["name"]) || modelID, provider: text(provider["name"]) || providerID };
}

export async function opencodeRecentModels(paths: OpencodePaths = opencodePaths()): Promise<OpencodeModelChoice[]> {
  const [state, catalog] = await Promise.all([readJson(paths.recent), readCatalog(paths.catalog)]);
  const recent = Array.isArray(state["recent"]) ? state["recent"] : [];
  const seen = new Set<string>();
  return recent.flatMap((entry) => {
    const ref = record(entry);
    const providerID = text(ref["providerID"]);
    const modelID = text(ref["modelID"]);
    const id = `${providerID}/${modelID}`;
    if (!providerID || !modelID || seen.has(id)) return [];
    seen.add(id);
    return [choiceOf(catalog, providerID, modelID)];
  });
}

function footerLabel(choice: OpencodeModelChoice): string {
  return ` · ${choice.name} ${choice.provider}`;
}

function showsLabel(line: string, label: string): boolean {
  for (let at = line.indexOf(label); at >= 0; at = line.indexOf(label, at + 1)) {
    if (!NAME_CHAR.test(line.charAt(at + label.length))) return true;
  }
  return false;
}

function longestShown(line: string, models: OpencodeModelChoice[]): OpencodeModelChoice | null {
  return models.reduce<OpencodeModelChoice | null>((best, choice) => {
    if (!showsLabel(line, footerLabel(choice))) return best;
    return best && footerLabel(best).length >= footerLabel(choice).length ? best : choice;
  }, null);
}

export function findShown(screen: string, models: OpencodeModelChoice[]): Shown | null {
  const lines = screen.split("\n");
  for (let line = lines.length - 1; line >= 0; line -= 1) {
    const match = longestShown(lines[line]!, models);
    if (match) return { id: match.id, line };
  }
  return null;
}

export function dialogShown(screen: string): boolean {
  return screen.split("\n").some((line) => DIALOG_TITLE.test(line));
}

function lineOf(screen: string, line: number): string {
  return screen.split("\n")[line] ?? "";
}

async function settle(pane: OpencodePane, done: (screen: string) => boolean): Promise<string | null> {
  for (let waited = 0; waited <= SETTLE_MS; waited += POLL_MS) {
    const screen = await pane.screen();
    if (done(screen)) return screen;
    await pane.wait(POLL_MS);
  }
  return null;
}

async function closeDialog(pane: OpencodePane): Promise<string> {
  const screen = await pane.screen();
  if (!dialogShown(screen)) return screen;
  await pane.press("esc");
  const closed = await settle(pane, (next) => !dialogShown(next));
  if (closed === null) throw new OpencodeSwitchError("dialog_stuck");
  return closed;
}

export async function switchOpencodeModel(pane: OpencodePane, models: OpencodeModelChoice[], target: string): Promise<void> {
  if (!models.some((choice) => choice.id === target)) throw new OpencodeSwitchError("not_listed");
  const screen = await closeDialog(pane);
  const start = findShown(screen, models);
  if (start === null) throw new OpencodeSwitchError("not_shown");
  let footer = lineOf(screen, start.line);
  let shown: string | null = start.id;
  for (let presses = 0; shown !== target; presses += 1) {
    if (presses === MAX_PRESSES) throw new OpencodeSwitchError("not_reachable");
    await pane.press("f2");
    const next = await settle(pane, (candidate) => lineOf(candidate, start.line) !== footer);
    if (next === null) throw new OpencodeSwitchError("no_response");
    footer = lineOf(next, start.line);
    shown = findShown(next, models)?.id ?? null;
    if (shown === start.id) throw new OpencodeSwitchError("not_reachable");
  }
}

function herdrOpencodePane(paneId: string): OpencodePane {
  return {
    screen: async () => (await paneRead({ paneId, source: "visible", format: "text" })).text,
    press: (key) => key === "esc" ? paneSendKeys(paneId, ["esc"]) : paneSendText(paneId, F2),
    wait: (ms) => Bun.sleep(ms),
  };
}

export async function paneOpencodeModels(paneId: string): Promise<OpencodeModels> {
  const [models, screen] = await Promise.all([opencodeRecentModels(), herdrOpencodePane(paneId).screen()]);
  return { current: findShown(screen, models)?.id ?? null, models };
}

const switching = new Set<string>();

export async function switchPaneOpencodeModel(paneId: string, target: string): Promise<void> {
  if (switching.has(paneId)) throw new OpencodeSwitchError("busy");
  switching.add(paneId);
  try {
    await switchOpencodeModel(herdrOpencodePane(paneId), await opencodeRecentModels(), target);
  } finally {
    switching.delete(paneId);
  }
}
