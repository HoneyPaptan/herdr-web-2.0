import { Database } from "bun:sqlite";
import { join } from "node:path";

import type { ConversationMetadata, ConversationPart, ConversationTurn } from "../shared/protocol.ts";
import { trimOutput } from "./tool-output.ts";
import { toolSummary } from "./transcript-records.ts";

const PAGE_TURNS = 20;
const CURSOR = /^(\d{1,16})\.(msg_[A-Za-z0-9]{8,64})$/;
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;
const USER_MESSAGE = "json_extract(data, '$.role') = 'user'";
const SESSION_ID = /^ses_[A-Za-z0-9]{8,64}$/;
export const OPENCODE_IMAGE_REF = /^prt_[A-Za-z0-9]{8,64}$/;
const ATTACHED_RESOURCE = /^\[[a-z][a-z0-9+.-]*:\/\/[^\]\s]+\]\n/;

type Row = Record<string, unknown>;
type ToolPart = Extract<ConversationPart, { kind: "tool" }>;
type MessageRow = { id: string; data: string };
type PartRow = { id: string; message_id: string; data: string };
type Position = { at: number; id: string };

export type OpencodePage = { before?: string; since?: string; from?: string };
export type OpencodeConversation = { turns: ConversationTurn[]; metadata: ConversationMetadata; cursor: string | null; signature: string };

export class UnknownOpencodeCursor extends Error {
  constructor() { super("history_changed"); }
}

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

function imagePart(id: string, part: Row): ConversationPart[] {
  const mime = text(part["mime"]);
  return mime.startsWith("image/") && text(part["url"]).startsWith("data:") ? [{ kind: "image", media_type: mime, ref: id }] : [];
}

function userParts(parts: PartRow[]): ConversationPart[] {
  return parts.flatMap(({ id, data }) => {
    const part = parseRow(data);
    if (part["type"] === "file") return imagePart(id, part);
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

export function buildOpencodeTurns(messages: MessageRow[], parts: PartRow[]): { turns: ConversationTurn[]; metadata: ConversationMetadata } {
  const byMessage = new Map<string, PartRow[]>();
  for (const part of parts) byMessage.set(part.message_id, [...byMessage.get(part.message_id) ?? [], part]);
  const turns: ConversationTurn[] = [];
  let metadata: ConversationMetadata = { model: null, reasoning_effort: null };
  let reply: ConversationTurn | null = null;
  for (const { id, data } of messages) {
    const message = parseRow(data);
    const time = record(message["time"]);
    const own = byMessage.get(id) ?? [];
    if (message["role"] === "user") {
      reply = null;
      const shown = userParts(own);
      if (shown.length > 0) turns.push({ role: "user", ts: isoTime(time["created"]), parts: shown });
      continue;
    }
    if (message["role"] !== "assistant") continue;
    metadata = metadataOf(message, metadata);
    if (reply === null) {
      reply = { role: "assistant", ts: isoTime(time["created"]), parts: [] };
      turns.push(reply);
    }
    reply.parts.push(...assistantParts(own, message["summary"] === true));
    const end = isoTime(time["completed"]) ?? isoTime(time["created"]);
    if (end) reply.end_ts = end;
  }
  return { turns: turns.filter((turn) => turn.parts.length > 0), metadata };
}

function formatCursor(position: Position | null): string | null {
  return position === null ? null : `${position.at}.${position.id}`;
}

function isBefore(left: Position, right: Position): boolean {
  return left.at < right.at || (left.at === right.at && left.id < right.id);
}

function turnStart(db: Database, sessionId: string, cursor: string): Position {
  const match = CURSOR.exec(cursor);
  const row = match && db.query<Position, [string, string, number]>(`select time_created as at, id from message where session_id = ? and id = ? and time_created = ? and ${USER_MESSAGE}`).get(sessionId, match[2]!, Number(match[1]));
  if (!row) throw new UnknownOpencodeCursor();
  return row;
}

function rangeClause(from: Position | null, to: Position | null): { sql: string; values: (string | number)[] } {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (from !== null) { clauses.push("(time_created, id) >= (?, ?)"); values.push(from.at, from.id); }
  if (to !== null) { clauses.push("(time_created, id) < (?, ?)"); values.push(to.at, to.id); }
  return { sql: clauses.map((clause) => ` and ${clause}`).join(""), values };
}

function pageStart(db: Database, sessionId: string, floor: Position | null, to: Position | null): Position | null {
  const range = rangeClause(floor, to);
  const starts = db.query<Position, (string | number)[]>(`select time_created as at, id from message where session_id = ? and ${USER_MESSAGE}${range.sql} order by time_created desc, id desc limit ?`).all(sessionId, ...range.values, PAGE_TURNS);
  return starts.length === PAGE_TURNS ? starts.at(-1)! : floor;
}

function atBeginning(db: Database, sessionId: string, start: Position | null): boolean {
  if (start === null) return true;
  const range = rangeClause(null, start);
  return db.query(`select 1 from message where session_id = ?${range.sql} limit 1`).get(sessionId, ...range.values) === null;
}

function pageMessages(db: Database, sessionId: string, from: Position | null, to: Position | null): MessageRow[] {
  const range = rangeClause(from, to);
  return db.query<MessageRow, (string | number)[]>(`select id, data from message where session_id = ?${range.sql} order by time_created, id`).all(sessionId, ...range.values);
}

function pageParts(db: Database, messages: MessageRow[]): PartRow[] {
  if (messages.length === 0) return [];
  const ids = messages.map((message) => message.id);
  return db.query<PartRow, string[]>(`select id, message_id, data from part where message_id in (${ids.map(() => "?").join(",")}) order by id`).all(...ids);
}

function sessionSignature(db: Database, sessionId: string): string | null {
  const messages = db.query<{ count: number; updated: number | null }, [string]>("select count(*) as count, max(time_updated) as updated from message where session_id = ?").get(sessionId);
  if (!messages || messages.count === 0) return null;
  const parts = db.query<{ count: number; updated: number | null }, [string]>("select count(*) as count, max(time_updated) as updated from part where session_id = ?").get(sessionId);
  return `${messages.count}:${messages.updated ?? 0}:${parts?.count ?? 0}:${parts?.updated ?? 0}`;
}

function pageBounds(db: Database, sessionId: string, page: OpencodePage): { from: Position | null; to: Position | null } {
  if (page.before !== undefined) {
    const to = turnStart(db, sessionId, page.before);
    const floor = page.since === undefined ? null : turnStart(db, sessionId, page.since);
    if (floor !== null && isBefore(to, floor)) throw new UnknownOpencodeCursor();
    return { from: pageStart(db, sessionId, floor, to), to };
  }
  const held = page.from === undefined ? null : turnStart(db, sessionId, page.from);
  const newest = pageStart(db, sessionId, null, null);
  return { from: held !== null && (newest === null || !isBefore(held, newest)) ? held : newest, to: null };
}

export function readOpencodeConversation(path: string, sessionId: string, page: OpencodePage = {}): OpencodeConversation | null {
  return withDb(path, (db) => {
    const signature = sessionSignature(db, sessionId);
    if (signature === null) return null;
    const { from, to } = pageBounds(db, sessionId, page);
    const messages = pageMessages(db, sessionId, from, to);
    const cursor = atBeginning(db, sessionId, from) ? null : formatCursor(from);
    return { ...buildOpencodeTurns(messages, pageParts(db, messages)), cursor, signature };
  });
}

export function readOpencodeImage(path: string, sessionId: string, ref: string): { mediaType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  return withDb(path, (db) => {
    const row = db.query<{ data: string }, [string, string]>("select data from part where id = ? and session_id = ?").get(ref, sessionId);
    const url = row ? DATA_URL.exec(text(parseRow(row.data)["url"])) : null;
    if (!url || !url[1]!.startsWith("image/")) return null;
    return { mediaType: url[1]!, bytes: Uint8Array.from(Buffer.from(url[2]!, "base64")) };
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
