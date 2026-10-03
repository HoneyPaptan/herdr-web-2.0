import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConversationUnavailable, opencodeConversation } from "./conversation.ts";
import { isOpencodeSession, opencodeDbPath, readOpencodeConversation, readOpencodeToolOutput } from "./opencode-store.ts";
import { TOOL_OUTPUT_CHARS } from "./tool-output.ts";

const SESSION = "ses_f01cf11b8ffeQ3UG4W9YjrwAma";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Message = { id: string; at: number; data: Record<string, unknown>; parts: Record<string, unknown>[] };

function store(messages: Message[], session = SESSION): string {
  const root = mkdtempSync(join(tmpdir(), "opencode-store-"));
  roots.push(root);
  const path = join(root, "opencode.db");
  const db = new Database(path);
  db.run("create table message (id text primary key, session_id text, time_created integer, time_updated integer, data text)");
  db.run("create table part (id text primary key, message_id text, session_id text, time_created integer, time_updated integer, data text)");
  for (const message of messages) {
    db.run("insert into message values (?, ?, ?, ?, ?)", [message.id, session, message.at, message.at, JSON.stringify(message.data)]);
    message.parts.forEach((part, index) => {
      db.run("insert into part values (?, ?, ?, ?, ?, ?)", [`prt_${message.id}_${index}`, message.id, session, message.at, message.at, JSON.stringify(part)]);
    });
  }
  db.close();
  return path;
}

const user = (id: string, at: number, ...parts: Record<string, unknown>[]): Message => ({ id, at, data: { role: "user", time: { created: at } }, parts });
const assistant = (id: string, at: number, data: Record<string, unknown>, ...parts: Record<string, unknown>[]): Message => ({
  id, at, data: { role: "assistant", modelID: "big-pickle", variant: "high", time: { created: at, completed: at + 5 }, tokens: { input: 900, cache: { read: 100, write: 0 } }, ...data }, parts,
});

describe("readOpencodeConversation", () => {
  it("turns a session's messages into chat turns, merging one reply's steps", () => {
    const path = store([
      user("msg_1", 1_000, { type: "text", text: "fix the build" }, { type: "text", text: "[cydonia://session/context]\nworkspace notes" }, { type: "text", text: "hidden", synthetic: true }),
      assistant("msg_2", 2_000, {}, { type: "step-start" }, { type: "reasoning", text: "look at the log" }, {
        type: "tool", tool: "bash", state: { status: "completed", title: "bun run build", input: { command: "bun run build" }, output: "ok" },
      }),
      assistant("msg_3", 3_000, {}, { type: "tool", tool: "read", state: { status: "error", input: { filePath: "/x" }, error: "not found" } }, { type: "text", text: "Fixed." }),
    ]);
    const read = readOpencodeConversation(path, SESSION)!;
    expect(read.turns).toEqual([
      { role: "user", ts: new Date(1_000).toISOString(), parts: [{ kind: "text", text: "fix the build" }] },
      {
        role: "assistant", ts: new Date(2_000).toISOString(), end_ts: new Date(3_005).toISOString(), parts: [
          { kind: "thinking", text: "look at the log" },
          { kind: "tool", name: "bash", summary: "bun run build", input: JSON.stringify({ command: "bun run build" }, null, 2), output: "ok" },
          { kind: "tool", name: "read", summary: "read", input: JSON.stringify({ filePath: "/x" }, null, 2), output: "not found", error: true },
          { kind: "text", text: "Fixed." },
        ],
      },
    ]);
    expect(read.metadata).toEqual({ model: "big-pickle", reasoning_effort: "high", context: { used: 1_000, window: null } });
  });

  it("shows a compaction's summary as one and drops the turn that asked for it", () => {
    const path = store([
      user("msg_1", 1_000, { type: "compaction", auto: true }),
      assistant("msg_2", 2_000, { summary: true, mode: "compaction" }, { type: "text", text: "Earlier we fixed the build." }),
    ]);
    expect(readOpencodeConversation(path, SESSION)!.turns.map((turn) => [turn.role, turn.parts])).toEqual([
      ["assistant", [{ kind: "compact", text: "Earlier we fixed the build." }]],
    ]);
  });

  it("cuts a long tool output and fetches the whole of it by the part id", () => {
    const output = "x".repeat(TOOL_OUTPUT_CHARS + 10);
    const path = store([assistant("msg_1", 1_000, {}, { type: "tool", tool: "bash", state: { status: "completed", input: { command: "cat big" }, output } })]);
    const read = readOpencodeConversation(path, SESSION)!;
    const tool = read.turns[0]!.parts[0] as { output_ref?: string; output_size?: number };
    expect(tool.output_ref).toBe("prt_msg_1_0");
    expect(tool.output_size).toBe(output.length);
    expect(readOpencodeToolOutput(path, SESSION, "prt_msg_1_0")).toBe(output);
    expect(readOpencodeToolOutput(path, "ses_otherSession00", "prt_msg_1_0")).toBeNull();
  });

  it("changes its signature when a running step writes more", () => {
    const first = store([assistant("msg_1", 1_000, {}, { type: "text", text: "Working" })]);
    const second = store([assistant("msg_1", 1_000, {}, { type: "text", text: "Working" }, { type: "text", text: "Done" })]);
    expect(readOpencodeConversation(first, SESSION)!.signature).not.toBe(readOpencodeConversation(second, SESSION)!.signature);
  });

  it("answers null for a session with no messages yet", () => {
    expect(readOpencodeConversation(store([]), SESSION)).toBeNull();
  });
});

describe("opencodeConversation", () => {
  it("reports a session that has not written anything as not started", () => {
    const run = () => opencodeConversation(SESSION, store([]));
    expect(run).toThrow(ConversationUnavailable);
    expect(run).toThrow("transcript_missing");
  });

  it("names the session as the history and starts at the beginning", () => {
    const conversation = opencodeConversation(SESSION, store([user("msg_1", 1_000, { type: "text", text: "hi" })]));
    expect(conversation.source).toBe("opencode-transcript");
    expect(conversation.history_id).toBe(SESSION);
    expect(conversation.cursor).toBeNull();
  });
});

describe("opencode paths", () => {
  it("finds the store under XDG_DATA_HOME, else under HOME", () => {
    expect(opencodeDbPath({ XDG_DATA_HOME: "/data", HOME: "/home/a" })).toBe("/data/opencode/opencode.db");
    expect(opencodeDbPath({ HOME: "/home/a" })).toBe("/home/a/.local/share/opencode/opencode.db");
  });

  it("accepts only opencode session ids", () => {
    expect(isOpencodeSession(SESSION)).toBe(true);
    expect(isOpencodeSession("0b6f3c2e-1111-4222-8333-444455556666")).toBe(false);
    expect(isOpencodeSession(undefined)).toBe(false);
  });
});
