import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { OpencodeModelChoice, OpencodeModels } from "../shared/opencode-model.ts";
import { paneSendKeys, paneSendText } from "./herdr/client.ts";
import { PaneSwitchError, cycleTo, exclusive, herdrScreenPane, settle, type ScreenPane, type Shown } from "./pane-switch.ts";

const F2 = "\x1bOQ";
const DIALOG_TITLE = /^[\s│┃|]*Select (?:model|variant)\b/;
const NAME_CHAR = /[\p{L}\p{N}._-]/u;

type Row = Record<string, unknown>;

export type OpencodeKey = "esc" | "f2";
export type OpencodePaths = { recent: string; catalog: string };

export interface OpencodePane extends ScreenPane {
  press(key: OpencodeKey): Promise<void>;
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

async function closeDialog(pane: OpencodePane): Promise<string> {
  const screen = await pane.screen();
  if (!dialogShown(screen)) return screen;
  await pane.press("esc");
  const closed = await settle(pane, (next) => !dialogShown(next));
  if (closed === null) throw new PaneSwitchError("dialog_stuck");
  return closed;
}

export async function switchOpencodeModel(pane: OpencodePane, models: OpencodeModelChoice[], target: string): Promise<void> {
  if (!models.some((choice) => choice.id === target)) throw new PaneSwitchError("not_listed");
  const screen = await closeDialog(pane);
  await cycleTo(pane, screen, target, (next) => findShown(next, models), () => pane.press("f2"));
}

function herdrOpencodePane(paneId: string): OpencodePane {
  return {
    ...herdrScreenPane(paneId),
    press: (key) => key === "esc" ? paneSendKeys(paneId, ["esc"]) : paneSendText(paneId, F2),
  };
}

export async function paneOpencodeModels(paneId: string): Promise<OpencodeModels> {
  const [models, screen] = await Promise.all([opencodeRecentModels(), herdrOpencodePane(paneId).screen()]);
  return { current: findShown(screen, models)?.id ?? null, models };
}

export function switchPaneOpencodeModel(paneId: string, target: string): Promise<void> {
  return exclusive(paneId, async () => switchOpencodeModel(herdrOpencodePane(paneId), await opencodeRecentModels(), target));
}
