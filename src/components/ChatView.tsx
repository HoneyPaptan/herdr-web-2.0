import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ArrowDown, BookOpen, Bot, Brain, Check, ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot, CircleSlash, Copy, FilePen, FileSearch, Globe, ListChecks, Target, Terminal, Wrench,
  type LucideProps,
} from "lucide-react";

import "./ChatView.css";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AgentMark } from "./AgentMark.tsx";
import { Markdown } from "./Markdown.tsx";
import { PromptCard } from "./PromptCard.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { turnRevision } from "../lib/turnRevision.ts";
import { useWholeOutput as useScopedOutput } from "../lib/useWholeOutput.ts";
import { turnSkills } from "../lib/skillActivity.ts";
import { ApiError } from "../lib/api.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { toTranscriptMessages, type TranscriptMessage } from "../lib/transcript.ts";
import { isLiveWorkTurn, formatWorkDuration, splitTurn, workSummary, type ToolPart as ToolPartType } from "../lib/workBlocks.ts";
import { phaseRows, planRows, taskRows, todoRows, type ChecklistRow } from "../lib/checklist.ts";
import { isTodoTool, parseTodoAnswer, todoCallSummary, type TodoItem, type TodoStatus } from "../lib/todos.ts";
import { formatGoalTime, turnGoal, type GoalState, type GoalStatus } from "../lib/goals.ts";
import { useSettings } from "../lib/settings.ts";
import { statusEdgeRead } from "../lib/status.ts";
import { usePageVisible } from "../lib/visibility.ts";
import { dismissKeyboardOn } from "../lib/keyboard.ts";
import { OpenFileContext } from "../lib/filePaths.ts";
import { patchText } from "../../shared/patch.ts";
import { machinePath } from "../../shared/machines.ts";
import { fileUrl } from "../lib/api.ts";
import { useMachineId } from "../lib/machineContext.tsx";
import { lineDiff } from "../lib/diff.ts";
import { formatTokens } from "../lib/compose.ts";

const ChatPaneContext = createContext<string | null>(null);
const ChatHistoryContext = createContext("");
import type { TypedAnswer } from "../lib/promptAnswer.ts";
import type { AgentStatus, ConversationMetadata, ConversationPart, ConversationTurn, InteractivePrompt } from "../../shared/protocol.ts";
import { currentLocale, useT } from "../lib/i18n.ts";

const TRANSCRIPT_LINES = 400;
const POLL_MS = 2000;
const LOAD_OLDER_PX = 400;

export interface ChatViewProps {
  paneId: string;
  refreshKey: number;
  sentKey?: number;
  connected: boolean;
  ended: boolean;
  agent: string | null;
  agentStatus?: AgentStatus;
  onMetadata?: (paneId: string, metadata: ConversationMetadata | null) => void;
  onPrompt?: (paneId: string, prompt: InteractivePrompt | null) => void;
  onSuggestion?: (paneId: string, suggestion: string | null) => void;
  promptRefreshKey?: number;
  pendingAnswer?: { promptId: string; answer: TypedAnswer } | null;
  onPendingAnswerDone?: () => void;
}

interface ChatState {
  source: "conversation" | "scrollback";
  turns: ConversationTurn[];
  messages: TranscriptMessage[];
  truncated: boolean;
}

const EMPTY_STATE: ChatState = { source: "conversation", turns: [], messages: [], truncated: false };


function formatTime(ts: string | null): string | null {
  if (ts === null) return null;
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/gi, "$1")
    .replace(/(?:\*\*|__|~~|`)(.*?)(?:\*\*|__|~~|`)/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^>\s?/gm, "");
}

const TURN = "chat-turn w-full [contain-intrinsic-size:auto_160px] [content-visibility:auto]";
const TURN_META = "chat-turn-meta flex min-h-6 items-center gap-0.5 text-ui text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-focus-within/turn:opacity-100 group-hover/turn:opacity-100 pointer-coarse:opacity-100";

function CopyButton({ text, label, children }: { text: string; label: string; children?: React.ReactNode }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="ghost" size={children ? "xs" : "icon-xs"} className={cn("text-muted-foreground hover:text-foreground", children ? "pointer-coarse:h-8" : "pointer-coarse:size-8")} onClick={() => void copy()} aria-label={copied ? t("Copied") : label}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {children}
    </Button>
  );
}

function ChecklistView({ rows }: { rows: ChecklistRow[] }) {
  return <ul className="chat-checklist">{rows.map((row, index) => (
    <li key={index} className={row.heading ? "chat-checklist-phase" : row.done ? "is-done" : row.active ? "is-active" : undefined}>
      {!row.heading && <span className="chat-checklist-box" aria-hidden="true">{row.done ? "✓" : "•"}</span>}{row.label}
    </li>
  ))}</ul>;
}

const TODO_ICONS: Record<TodoStatus, ComponentType<LucideProps>> = {
  completed: CircleCheck, in_progress: CircleDot, pending: Circle, blocked: CircleAlert, dropped: CircleSlash,
};
const TODO_LABELS: Record<TodoStatus, string> = {
  completed: "done", in_progress: "in progress", pending: "to do", blocked: "blocked", dropped: "dropped",
};

function TodoList({ items }: { items: TodoItem[] }) {
  const groups: { phase: string | null; items: TodoItem[] }[] = [];
  for (const item of items) {
    const group = groups[groups.length - 1];
    if (group && group.phase === item.phase) group.items.push(item); else groups.push({ phase: item.phase, items: [item] });
  }
  return <div className="todo-list">{groups.map((group, index) => (
    <div key={index} className="todo-group">
      {group.phase !== null && <p className="todo-phase">{group.phase}</p>}
      <ul>{group.items.map((item, row) => {
        const Icon = TODO_ICONS[item.status];
        return <li key={row} className={`todo-item is-${item.status}`}>
          <Icon className="todo-icon" aria-hidden="true" />
          <span className="todo-label">{item.label}<span className="sr-only"> ({TODO_LABELS[item.status]})</span>{item.note && <span className="todo-note">{item.note}</span>}</span>
        </li>;
      })}</ul>
    </div>
  ))}</div>;
}

function ompEditLineClass(line: string): string | undefined {
  if (line.startsWith("+-") || line.startsWith("-") || /^(CUT|REM)\b/.test(line)) return "chat-diff-del";
  if (line.startsWith("+")) return "chat-diff-add";
  if (/^(PUT|MV)/.test(line) || line.startsWith("[")) return "chat-diff-head";
  return undefined;
}

function ToolFile({ path, suffix }: { path: string; suffix?: string }) {
  const t = useT();
  const open = useContext(OpenFileContext);
  if (open === null) return <p className="chat-tool-file">{path}{suffix}</p>;
  return <p className="chat-tool-file"><button type="button" className="chat-tool-file-link" title={t("Open {path}", { path })} onClick={() => open(path)}>{path}</button>{suffix}</p>;
}

function EditDiff({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after);
  return <pre className="chat-diff">{lines.map((line, index) =>
    <span key={index} className={line.kind === "add" ? "chat-diff-add" : line.kind === "del" ? "chat-diff-del" : undefined}>{line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}{line.text}{"\n"}</span>)}</pre>;
}

function PatchView({ patch }: { patch: string }) {
  const sections: Array<{ file: string | null; action: string; lines: string[] }> = [];
  for (const line of patch.split("\n")) {
    const file = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (file !== null) { sections.push({ file: file[2]!.trim(), action: file[1]!, lines: [] }); continue; }
    if (/^\*\*\* (Begin|End) Patch/.test(line)) continue;
    if (sections.length === 0) sections.push({ file: null, action: "", lines: [] });
    sections.at(-1)!.lines.push(line);
  }
  for (const section of sections) while (section.lines.at(-1)?.trim() === "") section.lines.pop();
  const lineClass = (line: string): string | undefined =>
    line.startsWith("@@") || line.startsWith("*** Move to:") ? "chat-diff-head" : line.startsWith("+") ? "chat-diff-add" : line.startsWith("-") ? "chat-diff-del" : undefined;
  return <div className="chat-tool-io">{sections.map((section, index) => <div key={index}>
    {section.file !== null && <ToolFile path={section.file} suffix={section.action === "Update" ? undefined : ` (${section.action.toLowerCase()})`} />}
    {section.lines.length > 0 && <pre className="chat-diff">{section.lines.map((line, at) => <span key={at} className={lineClass(line)}>{line}{"\n"}</span>)}</pre>}
  </div>)}</div>;
}

function ToolInputView({ part }: { part: ToolPartType }) {
  const after = isTodoTool(part.name) ? parseTodoAnswer(part.output) : null;
  if (after !== null && after.length > 0) return <TodoList items={after} />;
  const patch = patchText(part.input);
  if (patch !== null) return <PatchView patch={patch} />;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(part.input) as Record<string, unknown>; }
  catch { return <pre className="chat-tool-io">{part.input}</pre>; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return <pre className="chat-tool-io">{part.input}</pre>;
  const str = (key: string): string | undefined => typeof parsed[key] === "string" ? parsed[key] : undefined;
  const command = str("command") ?? str("cmd");
  if (command !== undefined) return <div className="chat-tool-io"><pre>{command}</pre>{(str("cwd") ?? str("description")) !== undefined && <p className="chat-tool-io-meta">{str("cwd") ?? str("description")}</p>}</div>;
  const oldString = str("old_string");
  const newString = str("new_string");
  if (oldString !== undefined || newString !== undefined) return <div className="chat-tool-io">{str("file_path") !== undefined && <ToolFile path={str("file_path")!} />}<EditDiff before={oldString ?? ""} after={newString ?? ""} /></div>;
  if (Array.isArray(parsed["edits"]) && parsed["edits"].every((item) => item !== null && typeof item === "object")) {
    const edits = parsed["edits"] as Array<Record<string, unknown>>;
    return <div className="chat-tool-io">{str("file_path") !== undefined && <ToolFile path={str("file_path")!} />}{edits.map((item, index) =>
      <EditDiff key={index} before={typeof item["old_string"] === "string" ? item["old_string"] : ""} after={typeof item["new_string"] === "string" ? item["new_string"] : ""} />)}</div>;
  }
  const editScript = str("input");
  if (editScript !== undefined) return <pre className="chat-tool-io chat-diff">{editScript.split("\n").map((line, index) => <span key={index} className={ompEditLineClass(line)}>{line}{"\n"}</span>)}</pre>;
  const content = str("content");
  if (content !== undefined) return <div className="chat-tool-io">{(str("file_path") ?? str("path")) !== undefined && <ToolFile path={(str("file_path") ?? str("path"))!} />}<pre>{content}</pre></div>;
  const path = str("file_path") ?? str("path");
  if (path !== undefined) return <div className="chat-tool-io"><ToolFile path={path} suffix={str("pattern") !== undefined ? ` — /${str("pattern")}/` : undefined} /></div>;
  for (const [key, toRows] of [["list", phaseRows], ["todos", todoRows], ["plan", planRows], ["tasks", taskRows]] as const) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      const rows = toRows(value);
      if (rows.length > 0) return <ChecklistView rows={rows} />;
    }
  }
  return <pre className="chat-tool-io">{part.input}</pre>;
}

function toolIcon(name: string): ComponentType<LucideProps> {
  const normalized = name.toLowerCase();
  if (normalized === "skill") return BookOpen;
  if (normalized.includes("bash") || normalized.includes("command")) return Terminal;
  if (["read", "glob", "grep"].some((item) => normalized.includes(item))) return FileSearch;
  if (normalized.includes("edit") || normalized.includes("write")) return FilePen;
  if (normalized.includes("task") || normalized.includes("agent")) return Bot;
  if (normalized.includes("web")) return Globe;
  if (normalized.includes("todo")) return ListChecks;
  if (normalized.endsWith("_goal")) return Target;
  return Wrench;
}

function useWholeOutput(ref: string | undefined): { text: string | null; state: "idle" | "loading" | "failed"; load: () => void } {
  const paneId = useContext(ChatPaneContext);
  const machineId = useMachineId();
  const history = useContext(ChatHistoryContext);
  const url = ref === undefined || paneId === null ? null : machinePath(machineId, `pane/conversation/tool-output?${new URLSearchParams({ pane_id: paneId, ref }).toString()}`);
  return useScopedOutput(url, history);
}

function ToolImages({ paneId, part }: { paneId: string; part: ToolPartType }) {
  const t = useT();
  const machineId = useMachineId();
  if (part.images === undefined || part.images.length === 0) return null;
  return <div className="chat-tool-images">{part.images.map((image) => {
    const src = machinePath(machineId, `pane/conversation/image?${new URLSearchParams({ pane_id: paneId, ref: image.ref }).toString()}`);
    return <a key={image.ref} className="chat-user-image" href={src} target="_blank" rel="noopener noreferrer" title={t("Open image")}><img src={src} alt={t("Attached image")} loading="lazy" /></a>;
  })}</div>;
}

function WorkRow({ paneId, part }: { paneId: string; part: ToolPartType }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const whole = useWholeOutput(part.output_ref);
  const Icon = toolIcon(part.name);
  const summary = todoCallSummary(part) ?? part.summary;
  const output = isTodoTool(part.name) && parseTodoAnswer(part.output) !== null ? "" : whole.text ?? part.output;
  return <div className={`work-row${part.error ? " is-error" : ""}`}>
    <button type="button" className="work-row-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="work-row-caret" aria-hidden="true">{open ? <ChevronDown /> : <ChevronRight />}</span>
      <Icon className="work-row-icon" aria-hidden="true" />
      <span className="work-row-name">{part.name}</span>
      {part.error && <span className="work-row-failed">{t("failed")}</span>}
      {summary.length > 0 && summary !== part.name && <><span className="work-row-sep" aria-hidden="true">/</span><span className="work-row-summary">{summary}</span></>}
    </button>
    {open && <div className="work-row-detail"><ToolInputView part={part} /><ToolImages paneId={paneId} part={part} />{output.length > 0 && <section className="chat-tool-output"><h4>{t(part.error ? "Error" : "Output")}</h4><pre className={`chat-tool-io${whole.text !== null ? " is-whole" : ""}`}>{output}</pre>
      {part.output_ref !== undefined && whole.text === null && <button type="button" className="btn btn-ghost chat-tool-more" disabled={whole.state === "loading"} onClick={whole.load}>
        {t(whole.state === "loading" ? "Loading the whole output…" : whole.state === "failed" ? "Couldn't load the whole output — retry" : "Show the whole output ({size} characters)", { size: formatTokens(part.output_size ?? 0) })}
      </button>}</section>}</div>}
  </div>;
}

function ThinkingRow({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <div className="work-row work-row-thinking">
    <button type="button" className="work-row-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="work-row-caret" aria-hidden="true">{open ? <ChevronDown /> : <ChevronRight />}</span>
      <Brain className="work-row-icon" aria-hidden="true" />
      <span className="work-row-name">{t("thinking")}</span>
    </button>
    {open && <div className="work-row-detail work-thinking-text">{text}</div>}
  </div>;
}

function WorkBlockView({ paneId, parts, duration, live, defaultOpen, showThinking }: { paneId: string; parts: ConversationPart[]; duration: string | null; live: boolean; defaultOpen: boolean; showThinking: boolean }) {
  const t = useT();
  const [chosenOpen, setOpen] = useState<boolean | null>(null);
  const open = chosenOpen ?? defaultOpen;
  const visible = parts.filter((part) => part.kind !== "skill" && (showThinking || part.kind !== "thinking"));
  if (visible.length === 0) return null;
  const summary = workSummary(parts);
  const title = live ? t("Working…") : duration !== null ? t("Worked for {duration}", { duration }) : t("Worked");
  return <section className={`work-block${live ? " is-live" : ""}`}>
    <button type="button" className="work-block-head" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="work-row-caret" aria-hidden="true">{open ? <ChevronDown /> : <ChevronRight />}</span>
      <span className="work-block-title">{title}</span>
      {summary.length > 0 && <span className="work-block-summary">· {summary}</span>}
    </button>
    {open && <div className="work-block-rows">{visible.map((part, index) =>
      part.kind === "thinking" ? <ThinkingRow key={index} text={part.text} />
        : part.kind === "text" ? <div key={index} className="work-narration"><Markdown>{part.text}</Markdown></div>
          : part.kind === "tool" ? <WorkRow key={index} paneId={paneId} part={part} /> : null)}</div>}
  </section>;
}

function SkillActivityList({ parts }: { parts: ConversationPart[] }) {
  const t = useT();
  const skills = turnSkills(parts);
  if (skills.length === 0) return null;
  return <div className="chat-skills" role="group" aria-label={t("Skill activity")}>
    {skills.map((skill) => <details className={`chat-skill${skill.status === "failed" ? " is-error" : ""}`} key={`${skill.evidence}:${skill.path ?? skill.name}`}>
      <summary><BookOpen aria-hidden="true" /><span className="chat-skill-name">{skill.name}</span><span className="chat-skill-status">{
        skill.evidence === "invocation"
          ? skill.status === "failed" ? t("Skill invocation failed") : skill.status === "requested" ? t("Skill requested") : t("Skill invoked")
          : skill.status === "failed" ? t("Skill read failed") : skill.status === "requested" ? t("Reading skill requested") : t("Skill instructions loaded")
      }</span><ChevronDown className="chat-skill-caret" aria-hidden="true" /></summary>
      <div className="chat-skill-detail"><p>{skill.evidence === "invocation" ? t("Recorded by the agent's Skill tool. This does not mean the skill's work is complete.") : t("The transcript records loading this skill's instructions. This does not confirm every step was followed.")}</p>
        {skill.path && <code>{skill.path}</code>}
      </div>
    </details>)}
  </div>;
}

function GoalActivity({ goal }: { goal: GoalState }) {
  const t = useT();
  const word: Record<GoalStatus, string> = {
    active: t("in progress"), paused: t("paused"), blocked: t("blocked"), complete: t("complete"), budget_limited: t("out of budget"),
  };
  const spent = [
    goal.timeUsedSeconds !== null && goal.timeUsedSeconds > 0 ? formatGoalTime(goal.timeUsedSeconds) : null,
    goal.tokensUsed !== null && goal.tokensUsed > 0 ? t("{n} tokens", { n: formatTokens(goal.tokensUsed) }) : null,
  ].filter((item) => item !== null).join(" · ");
  return <details className={`chat-goal is-${goal.status}`}>
    <summary><Target aria-hidden="true" /><span className="chat-goal-label">{t("Goal")}</span><span className="chat-goal-objective">{goal.objective}</span>
      <span className="chat-goal-status">{word[goal.status]}</span><ChevronDown className="chat-skill-caret" aria-hidden="true" /></summary>
    <div className="chat-goal-detail">
      <p className="chat-goal-text">{goal.objective}</p>
      {goal.blockedReason !== null && <p className="chat-goal-reason">{goal.blockedReason}</p>}
      {spent.length > 0 && <p className="chat-goal-spent">{t("Used so far: {spent}", { spent })}</p>}
    </div>
  </details>;
}

const IMAGE_MENTION = /(?:^|\s)@(\S+\.(?:png|jpe?g|gif|webp))(?=\s|$)/gi;

function UserImages({ paneId, parts, text }: { paneId: string; parts: ConversationPart[]; text: string }) {
  const t = useT();
  const machineId = useMachineId();
  const open = useContext(OpenFileContext);
  const pasted = parts.filter((part): part is Extract<ConversationPart, { kind: "image" }> => part.kind === "image");
  const mentioned = [...new Set([...text.matchAll(IMAGE_MENTION)].map((match) => match[1]!))];
  if (pasted.length === 0 && mentioned.length === 0) return null;
  return <div className="chat-user-images">
    {pasted.map((part) => {
      const src = machinePath(machineId, `pane/conversation/image?${new URLSearchParams({ pane_id: paneId, ref: part.ref }).toString()}`);
      return <a key={part.ref} className="chat-user-image" href={src} target="_blank" rel="noopener noreferrer" title={t("Open image")}><img src={src} alt={t("Attached image")} loading="lazy" /></a>;
    })}
    {mentioned.map((path) => {
      const src = fileUrl(path, paneId, machineId);
      return open !== null
        ? <button key={path} type="button" className="chat-user-image" title={t("Open {path}", { path })} onClick={() => open(path)}><img src={src} alt={path} loading="lazy" /></button>
        : <a key={path} className="chat-user-image" href={src} target="_blank" rel="noopener noreferrer" title={path}><img src={src} alt={path} loading="lazy" /></a>;
    })}
  </div>;
}

interface TurnProps {
  paneId: string;
  turn: ConversationTurn;
  live: boolean;
  last: boolean;
  showThinking: boolean;
}

const Turn = memo(function Turn({ paneId, turn, live, last, showThinking }: TurnProps) {
  const t = useT();
  const time = formatTime(turn.ts);
  const compact = turn.parts.find((part): part is Extract<ConversationPart, { kind: "compact" }> => part.kind === "compact");
  if (compact !== undefined) {
    return <details className="chat-compact">
      <summary>{t("Conversation compacted")}{time !== null && <> · <time dateTime={turn.ts ?? undefined}>{time}</time></>}</summary>
      <div className="chat-compact-text"><Markdown>{compact.text}</Markdown></div>
    </details>;
  }
  const notice = turn.parts.find((part): part is Extract<ConversationPart, { kind: "notice" }> => part.kind === "notice");
  if (notice !== undefined) {
    return <details className="chat-compact chat-notice">
      <summary>{t("Background result delivered")}{time !== null && <> · <time dateTime={turn.ts ?? undefined}>{time}</time></>}</summary>
      <pre className="chat-compact-text chat-notice-text">{notice.text}</pre>
    </details>;
  }
  if (turn.role === "user") {
    const text = turn.parts.filter((part): part is Extract<ConversationPart, { kind: "text" }> => part.kind === "text").map((part) => part.text).join("\n\n");
    return <article className={cn(TURN, "chat-turn-user group/turn flex flex-col items-end gap-1.5")}>
      <UserImages paneId={paneId} parts={turn.parts} text={text} />
      {text.length > 0 && <div className="chat-bubble max-w-[85%] rounded-xl bg-card px-3 py-2 text-chat text-card-foreground shadow-(--shadow-card) wrap-anywhere"><Markdown>{text}</Markdown></div>}
      <SkillActivityList parts={turn.parts} />
      <div className={TURN_META}>{time !== null && <time className="px-1" dateTime={turn.ts ?? undefined}>{time}</time>}{text.length > 0 && <CopyButton text={text} label={t("Copy message")} />}</div>
    </article>;
  }
  const { work, answer } = splitTurn(turn.parts);
  const answerText = answer.map((part) => part.text).join("\n\n");
  const goal = turnGoal(turn.parts);
  return <article className={cn(TURN, "chat-turn-agent group/turn flex flex-col items-start gap-3 text-chat text-foreground")}>
    <SkillActivityList parts={turn.parts} />
    {goal !== null && <GoalActivity goal={goal} />}
    {work.length > 0 && <WorkBlockView paneId={paneId} parts={work} duration={formatWorkDuration(turn.ts, turn.end_ts ?? null)} live={live} defaultOpen={last} showThinking={showThinking} />}
    {answer.map((part, index) => <Markdown key={index}>{part.text}</Markdown>)}
    {answerText.length > 0 && <div className={cn(TURN_META, "-mt-2")}>
      <CopyButton text={answerText} label={t("Copy as markdown")}>MD</CopyButton>
      <CopyButton text={plainText(answerText)} label={t("Copy as plain text")}>TXT</CopyButton>
      {time !== null && <time className="px-1" dateTime={turn.ts ?? undefined}>{time}</time>}
    </div>}
  </article>;
});

function FallbackTurn({ paneId, message }: { paneId: string; message: TranscriptMessage }) {
  if (message.role === "status") return null;
  const turn: ConversationTurn = { role: message.role === "user" ? "user" : "assistant", ts: null, parts: [{ kind: "text", text: message.text }] };
  return <Turn paneId={paneId} turn={turn} live={false} last={false} showThinking={false} />;
}

export const ChatView = memo(function ChatView({ paneId, refreshKey, sentKey = 0, connected, ended, agent, agentStatus, onMetadata, onPrompt, onSuggestion, promptRefreshKey = 0, pendingAnswer = null, onPendingAnswerDone }: ChatViewProps) {
  const t = useT();
  const { fetchPaneConversation, fetchPanePromptState, fetchPaneTranscript } = useMachineApi();
  const { settings } = useSettings();
  const visible = usePageVisible();
  const lastAnswer = useRef<unknown>(null);
  const [state, setState] = useState<ChatState>(EMPTY_STATE);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [newMessages, setNewMessages] = useState(false);
  const [away, setAway] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState<InteractivePrompt | null>(null);
  const [abandoned, setAbandoned] = useState<{ count: number; branches: number; summary: string | null } | null>(null);
  const onSuggestionRef = useRef(onSuggestion);
  onSuggestionRef.current = onSuggestion;
  const sentKeyRef = useRef(sentKey);
  sentKeyRef.current = sentKey;
  const [promptPollKey, setPromptPollKey] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const signature = useRef("");
  const [older, setOlder] = useState<ConversationTurn[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [olderState, setOlderState] = useState<"idle" | "loading" | "failed">("idle");
  const heldFrom = useRef<string | null>(null);
  const loadingOlder = useRef(false);
  const olderGeneration = useRef(0);
  const history = useRef<string | undefined>(undefined);
  const [historyId, setHistoryId] = useState<string | undefined>(undefined);
  const shownPane = useRef(paneId);
  const prepended = useRef<{ top: number; height: number } | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [sentOver, setSentOver] = useState<{ turn: ConversationTurn; page: ConversationTurn[] } | null>(null);
  const heldPage = useRef<ConversationTurn[]>([]);
  const seenSent = useRef(sentKey);
  const seenStatus = useRef<{ pane: string; status: AgentStatus | undefined }>({ pane: paneId, status: agentStatus });

  const dropOlder = (): void => {
    olderGeneration.current += 1; loadingOlder.current = false;
    heldFrom.current = null; prepended.current = null; setOlder([]); setOlderCursor(undefined); setOlderState("idle");
  };

  useEffect(() => {
    shownPane.current = paneId;
    history.current = undefined; setHistoryId(undefined);
    stickToBottom.current = true; signature.current = ""; setState(EMPTY_STATE); setNewMessages(false); setAway(false); setLoaded(false); setError(null); setErrorStatus(null); setPrompt(null); setAbandoned(null);
    dropOlder();
    lastAnswer.current = null;
    setSentOver(null);
  }, [paneId]);

  useEffect(() => {
    if (seenSent.current === sentKey) return;
    seenSent.current = sentKey;
    const page = heldPage.current;
    const last = page[page.length - 1];
    setSentOver(last?.role === "assistant" && agentStatus !== "working" && agentStatus !== "blocked" ? { turn: last, page } : null);
  }, [sentKey, agentStatus]);

  useEffect(() => {
    const seen = seenStatus.current;
    seenStatus.current = { pane: paneId, status: agentStatus };
    if (seen.pane === paneId && statusEdgeRead(seen.status, agentStatus)) setPollKey((key) => key + 1);
  }, [paneId, agentStatus]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: number | undefined;
    const turnsBetween = async (held: string, start: string): Promise<ConversationTurn[] | null> => {
      const pages: ConversationTurn[][] = [];
      let before = start;
      try {
        for (let step = 0; step < 32 && before !== held; step++) {
          const page = await fetchPaneConversation(paneId, { before, since: held });
          if (typeof page.cursor !== "string") return null;
          pages.unshift(page.turns);
          before = page.cursor;
        }
      } catch {
        return null;
      }
      return before === held ? pages.flat() : null;
    };
    const read = async (): Promise<void> => {
      let generation = olderGeneration.current;
      try {
        let conversation;
        try {
          conversation = await fetchPaneConversation(paneId, heldFrom.current === null ? undefined : { from: heldFrom.current });
        } catch (cause) {
          if (heldFrom.current === null || !(cause instanceof ApiError) || cause.status !== 409) throw cause;
          if (cancelled || generation !== olderGeneration.current) return;
          dropOlder(); setState(EMPTY_STATE); signature.current = ""; lastAnswer.current = null;
          generation = olderGeneration.current;
          conversation = await fetchPaneConversation(paneId);
        }
        if (cancelled || generation !== olderGeneration.current) return;
        if (history.current !== conversation.history_id) {
          dropOlder(); generation = olderGeneration.current;
          history.current = conversation.history_id; setHistoryId(conversation.history_id);
          stickToBottom.current = true; setNewMessages(false); setAway(false);
        }
        if (conversation === lastAnswer.current) { setError(null); setErrorStatus(null); return; }
        const held = heldFrom.current;
        let moved: ConversationTurn[] = [];
        if (held !== null && conversation.source !== "scrollback" && typeof conversation.cursor === "string" && conversation.cursor !== held) {
          const between = await turnsBetween(held, conversation.cursor);
          if (cancelled || generation !== olderGeneration.current) return;
          if (between === null) {
            dropOlder(); setState(EMPTY_STATE); signature.current = ""; lastAnswer.current = null;
            setPollKey((key) => key + 1); return;
          }
          else { moved = between; heldFrom.current = conversation.cursor; }
        }
        if (moved.length > 0) setOlder((turns) => [...turns, ...moved]);
        if (heldFrom.current === null) setOlderCursor(conversation.source === "scrollback" ? undefined : conversation.cursor);
        onMetadata?.(paneId, conversation.source === "scrollback" ? null : conversation.metadata ?? null);
        setAbandoned(conversation.abandoned ?? null);
        let next: ChatState;
        if (conversation.source !== "scrollback") next = { source: "conversation", turns: conversation.turns, messages: [], truncated: false };
        else {
          const result = await fetchPaneTranscript(paneId, TRANSCRIPT_LINES);
          if (cancelled) return;
          next = { source: "scrollback", turns: [], messages: toTranscriptMessages(result.text).filter((message) => message.role !== "status"), truncated: result.truncated === true };
        }
        const nextSignature = JSON.stringify(next);
        if (nextSignature !== signature.current) {
          if (signature.current !== "" && !stickToBottom.current) setNewMessages(true);
          signature.current = nextSignature;
          setState(next);
        }
        setError(null); setErrorStatus(null); setLoaded(true);
        lastAnswer.current = conversation;
      } catch (cause) {
        if (cancelled || generation !== olderGeneration.current) return;
        setLoaded(true);
        setError(cause instanceof Error ? cause.message : String(cause));
        setErrorStatus(cause instanceof ApiError ? cause.status : null);
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void read(), POLL_MS);
      }
    };
    void read();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [paneId, refreshKey, onMetadata, pollKey, visible]);

  const loadOlder = useCallback(async (): Promise<void> => {
    const node = scroller.current;
    if (node === null || loadingOlder.current || typeof olderCursor !== "string") return;
    const before = olderCursor;
    const generation = olderGeneration.current;
    loadingOlder.current = true;
    setOlderState("loading");
    try {
      const page = await fetchPaneConversation(paneId, { before });
      if (shownPane.current !== paneId || olderGeneration.current !== generation) return;
      if (page.history_id !== history.current) {
        dropOlder(); setState(EMPTY_STATE); signature.current = ""; lastAnswer.current = null;
        setPollKey((key) => key + 1); return;
      }
      if (page.source === "scrollback" || page.cursor === undefined) { setOlderCursor(undefined); setOlderState("idle"); return; }
      const first = heldFrom.current === null;
      heldFrom.current ??= before;
      prepended.current = { top: node.scrollTop, height: node.scrollHeight };
      setOlder((turns) => [...page.turns, ...turns]);
      setOlderCursor(page.cursor);
      setOlderState("idle");
      if (first) setPollKey((key) => key + 1);
    } catch (cause) {
      if (shownPane.current !== paneId || olderGeneration.current !== generation) return;
      if (cause instanceof ApiError && cause.status === 409) {
        dropOlder(); setState(EMPTY_STATE); signature.current = ""; lastAnswer.current = null;
        setPollKey((key) => key + 1);
      }
      else setOlderState("failed");
    } finally {
      if (olderGeneration.current === generation) loadingOlder.current = false;
    }
  }, [fetchPaneConversation, olderCursor, paneId]);

  useLayoutEffect(() => {
    const node = scroller.current;
    const anchor = prepended.current;
    if (node === null || anchor === null) return;
    prepended.current = null;
    node.scrollTop = anchor.top + (node.scrollHeight - anchor.height);
  }, [older]);

  const pollPrompt = connected && !ended && agent !== null;
  useEffect(() => {
    if (!pollPrompt) { setPrompt(null); onSuggestionRef.current?.(paneId, null); return; }
    if (!visible) return;
    let cancelled = false;
    let timer = 0;
    const readPrompt = async (): Promise<void> => {
      const sent = sentKeyRef.current;
      try {
        const next = await fetchPanePromptState(paneId);
        if (!cancelled) {
          setPrompt((current) => current?.id === next.prompt?.id ? current : next.prompt);
          if (sentKeyRef.current === sent) onSuggestionRef.current?.(paneId, next.suggestion);
        }
      }
      catch { if (!cancelled) { setPrompt(null); onSuggestionRef.current?.(paneId, null); } }
      finally { if (!cancelled) timer = window.setTimeout(() => void readPrompt(), POLL_MS); }
    };
    void readPrompt();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pollPrompt, paneId, promptPollKey, promptRefreshKey, fetchPanePromptState, visible]);

  useEffect(() => {
    onPrompt?.(paneId, prompt);
    return () => onPrompt?.(paneId, null);
  }, [onPrompt, paneId, prompt]);

  useEffect(() => () => onSuggestionRef.current?.(paneId, null), [paneId]);

  useEffect(() => {
    if (!visible) onPendingAnswerDone?.();
  }, [visible, onPendingAnswerDone]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node !== null && stickToBottom.current) node.scrollTop = node.scrollHeight;
  }, [state, prompt]);

  useEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const node = scroller.current;
    return node === null ? undefined : dismissKeyboardOn(node);
  }, []);

  const onScroll = (): void => {
    const node = scroller.current;
    if (node === null) return;
    stickToBottom.current = node.scrollTop + node.clientHeight >= node.scrollHeight - 48;
    setAway(!stickToBottom.current);
    if (stickToBottom.current) setNewMessages(false);
    if (node.scrollTop < LOAD_OLDER_PX && olderState === "idle") void loadOlder();
  };
  const scrollToBottom = (): void => {
    const node = scroller.current;
    if (node === null) return;
    node.scrollTo({ top: node.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    stickToBottom.current = true; setNewMessages(false); setAway(false);
  };
  const turns = useMemo(() => older.length > 0 ? [...older, ...state.turns] : state.turns, [older, state.turns]);
  heldPage.current = state.turns;
  const finishedBeforeSend = sentOver !== null && sentOver.page === state.turns ? sentOver.turn : null;
  const empty = state.source === "conversation" ? turns.length === 0 : state.messages.length === 0;

  return <ChatPaneContext.Provider value={paneId}><ChatHistoryContext.Provider value={historyId ?? ""}><div className="chat-view absolute inset-0 z-1 overflow-y-auto bg-background px-4 pt-6 pb-5 md:px-6" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-label={t("conversation of {pane}", { pane: paneId })}>
    <div className="chat-transcript mx-auto flex min-h-full w-[min(100%,var(--content-w))] flex-col gap-4 [font-family:var(--font-chat,var(--font-ui))] text-chat">
      {state.source === "conversation" && abandoned !== null && abandoned.count > 0 && (
        <details className="chat-compact chat-abandoned">
          <summary>{t(abandoned.branches > 1
            ? abandoned.count === 1 ? "{n} earlier turn on {b} branches you navigated away from" : "{n} earlier turns on {b} branches you navigated away from"
            : abandoned.count === 1 ? "{n} earlier turn on a branch you navigated away from" : "{n} earlier turns on a branch you navigated away from",
            { n: abandoned.count, b: abandoned.branches })}</summary>
          {abandoned.summary !== null
            ? <div className="chat-compact-text"><Markdown>{abandoned.summary}</Markdown></div>
            : <p className="chat-abandoned-note">{t("pi kept them in the session file but answers from the branch you chose. Use /tree in the terminal to go back.")}</p>}
        </details>
      )}
      {state.source === "conversation" && typeof olderCursor === "string" && (
        <button type="button" className="btn btn-ghost chat-older" disabled={olderState === "loading"} onClick={() => void loadOlder()}>
          {t(olderState === "loading" ? "Loading earlier messages…" : olderState === "failed" ? "Couldn't load earlier messages — retry" : "Earlier messages")}
        </button>
      )}
      {state.source === "conversation" && olderCursor === null && older.length > 0 && <p className="chat-endcap">{t("beginning of conversation")}</p>}
      {state.source === "conversation"
        ? turns.map((turn, index) => {
            const last = index === turns.length - 1;
            return <RenderBoundary key={`${paneId}:${historyId ?? ""}:${turn.role}:${turn.ts ?? index}`} resetKey={turnRevision(turn)} fallback={() => <p className="chat-inline-state chat-inline-error">{t("This message can't be shown here. The terminal has it.")}</p>}>
              <Turn paneId={paneId} turn={turn} live={isLiveWorkTurn(turn, last, agentStatus, finishedBeforeSend)} last={last} showThinking={settings.showThinking} />
            </RenderBoundary>;
          })
        : agent !== null
          ? <details className="chat-terminal-fallback"><summary>{t("Conversation unavailable — show terminal output")}</summary><pre>{state.messages.map((message) => message.text).join("\n\n")}</pre></details>
          : state.messages.map((message, index) => <FallbackTurn key={index} paneId={paneId} message={message} />)}
      {!ended && !connected && <p className="chat-inline-state">{t("reconnecting…")}</p>}
      {error !== null && <p className="chat-inline-state chat-inline-error" role="alert">{errorStatus === 401 ? "locked — the token gate is asking again" : error}</p>}
      {!loaded && error === null && <p className="chat-inline-state" role="status">{t("Loading conversation…")}</p>}
      {loaded && empty && error === null && prompt === null && <div className="chat-empty"><AgentMark agent={agent ?? "agent"} size={32} /><p>{t("No conversation yet — say something below")}</p></div>}
      {prompt !== null && <PromptCard paneId={paneId} prompt={prompt} typedAnswer={pendingAnswer?.promptId === prompt.id ? pendingAnswer.answer : null} onTypedAnswerDone={onPendingAnswerDone} onPromptChanged={() => setPromptPollKey((key) => key + 1)} onAnswered={() => {
        setPrompt(null);
        if (prompt.steps) setPromptPollKey((key) => key + 1);
        onPendingAnswerDone?.();
      }} />}
      {ended && <p className="chat-endcap">{t("terminal ended")}</p>}
    </div>
    {newMessages ? <button type="button" className="btn chat-new-messages" onClick={scrollToBottom}>{t("New messages")} <ArrowDown aria-hidden="true" /></button>
      : away && <button type="button" className="btn chat-new-messages is-icon" aria-label={t("Jump to latest")} title={t("Jump to latest")} onClick={scrollToBottom}><ArrowDown aria-hidden="true" /></button>}
  </div>
  </ChatHistoryContext.Provider></ChatPaneContext.Provider>;
});
