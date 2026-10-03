import { Database } from "bun:sqlite";
import { join } from "node:path";

import type { ConversationMetadata, ConversationPart, ConversationTurn } from "../shared/protocol.ts";
import { trimOutput } from "./tool-output.ts";
import { MAX_TURNS, toolSummary } from "./transcript-records.ts";

const MESSAGE_WINDOW = 600;
const SESSION_ID = /^ses_[A-Za-z0-9]{8,64}$/;
const ATTACHED_RESOURCE = /^\[[a-z][a-z0-9+.-]*:\/\/[^\]\s]+\]\n/;

type Row = Record<string, unknown>;
type ToolPart = Extract<ConversationPart, { kind: "tool" }>;
type MessageRow = { id: string; data: string };
type PartRow = { id: string; message_id: string; data: string };

export type OpencodeConversation = { turns: ConversationTurn[]; metadata: ConversationMetadata; signature: string };

export function isOpencodeSession(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

export function opencodeDbPath(env: Record<string, string | undefined> = process.env): string {
  const data = env["XDG_DATA_HOME"] || join(env["HOME"] ?? "", ".local", "share");
  return join(data, "opencode", "opencode.db");
}

function record(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {};
}

function parseRow(data: string): Row {
  try { return record(JSON.parse(data)); } catch { return {}; }
}

function isoTime(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function withDb<T>(path: string, read: (db: Database) => T): T {
  const db = new Database(path, { readonly: true });
  try { return read(db); } finally { db.close(); }
}

function toolPart(id: string, part: Row): ToolPart {
  const name = text(part["tool"]) || "tool";
  const state = record(part["state"]);
  const input = record(state["input"]);
  const title = text(state["title"]);
  const failed = state["status"] === "error";
  const tool: ToolPart = { kind: "tool", name, summary: title || toolSummary(name, input), input: JSON.stringify(input, null, 2), output: "" };
  if (failed) tool.error = true;
  trimOutput(tool, failed ? text(state["error"]) : text(state["output"]), id);
  return tool;
}

function userParts(parts: PartRow[]): ConversationPart[] {
  return parts.flatMap(({ data }) => {
    const part = parseRow(data);
    if (part["type"] !== "text" || part["synthetic"] === true || part["ignored"] === true) return [];
    const body = text(part["text"]).trim();
    return body && !ATTACHED_RESOURCE.test(body) ? [{ kind: "text" as const, text: body }] : [];
  });
}

function assistantParts(parts: PartRow[], summary: boolean): ConversationPart[] {
  return parts.flatMap(({ id, data }): ConversationPart[] => {
    const part = parseRow(data);
    const body = text(part["text"]).trim();
    if (part["type"] === "text" && body) return [summary ? { kind: "compact", text: body } : { kind: "text", text: body }];
    if (part["type"] === "reasoning" && body) return [{ kind: "thinking", text: body }];
    if (part["type"] === "tool") return [toolPart(id, part)];
    return [];
  });
}

function contextUsed(tokens: Row): number {
  const cache = record(tokens["cache"]);
  return [tokens["input"], cache["read"], cache["write"]].reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
}

function metadataOf(message: Row, before: ConversationMetadata): ConversationMetadata {
  const model = text(message["modelID"]);
  if (!model) return before;
  const metadata: ConversationMetadata = { model, reasoning_effort: text(message["variant"]) || null };
  const used = contextUsed(record(message["tokens"]));
  if (used > 0) metadata.context = { used, window: null };
  return metadata;
}

export function buildOpencodeTurns(messages: MessageRow[], parts: PartRow[], maxTurns = MAX_TURNS): { turns: ConversationTurn[]; metadata: ConversationMetadata } {
  const byMessage = new Map<string, PartRow[]>();
  for (const part of parts) byMessage.set(part.message_id, [...byMessage.get(part.message_id) ?? [], part]);
  const turns: ConversationTurn[] = [];
  let metadata: ConversationMetadata = { model: null, reasoning_effort: null };
  for (const { id, data } of messages) {
    const message = parseRow(data);
    const time = record(message["time"]);
    const own = byMessage.get(id) ?? [];
    if (message["role"] === "user") {
      const shown = userParts(own);
      if (shown.length > 0) turns.push({ role: "user", ts: isoTime(time["created"]), parts: shown });
      continue;
    }
    if (message["role"] !== "assistant") continue;
    metadata = metadataOf(message, metadata);
    let turn = turns.at(-1);
    if (turn?.role !== "assistant") {
      turn = { role: "assistant", ts: isoTime(time["created"]), parts: [] };
      turns.push(turn);
    }
    turn.parts.push(...assistantParts(own, message["summary"] === true));
    const end = isoTime(time["completed"]) ?? isoTime(time["created"]);
    if (end) turn.end_ts = end;
  }
  return { turns: turns.filter((turn) => turn.parts.length > 0).slice(-maxTurns), metadata };
}

export function readOpencodeConversation(path: string, sessionId: string): OpencodeConversation | null {
  return withDb(path, (db) => {
    const newest = db.query<MessageRow, [string, number]>("select id, data from message where session_id = ? order by time_created desc, id desc limit ?").all(sessionId, MESSAGE_WINDOW);
    if (newest.length === 0) return null;
    const messages = newest.reverse();
    const ids = messages.map((message) => message.id);
    const parts = db.query<PartRow, string[]>(`select id, message_id, data from part where message_id in (${ids.map(() => "?").join(",")}) order by id`).all(...ids);
    const stamp = db.query<{ updated: number | null; count: number }, [string]>("select max(time_updated) as updated, count(*) as count from part where session_id = ?").get(sessionId);
    const signature = `${messages.length}:${messages.at(-1)!.id}:${stamp?.count ?? 0}:${stamp?.updated ?? 0}`;
    return { ...buildOpencodeTurns(messages, parts), signature };
  });
}

export function readOpencodeToolOutput(path: string, sessionId: string, ref: string): string | null {
  return withDb(path, (db) => {
    const row = db.query<{ data: string }, [string, string]>("select data from part where id = ? and session_id = ?").get(ref, sessionId);
    if (!row) return null;
    const state = record(parseRow(row.data)["state"]);
    return state["status"] === "error" ? text(state["error"]) : text(state["output"]);
  });
}
