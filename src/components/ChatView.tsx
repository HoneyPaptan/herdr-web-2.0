import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  ArrowDown, Check, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot, CircleSlash, Copy,
  type LucideProps,
} from "lucide-react";

import "./ChatView.css";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AgentMark } from "./AgentMark.tsx";
import { Orb } from "./Orb.tsx";
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

const PLAN_LIST = "m-0 flex list-none flex-col gap-1.5 p-0";
const PLAN_ITEM = "flex items-start gap-2 text-chat leading-snug";
const PLAN_PHASE = "m-0 mt-1 text-ui font-medium text-muted-foreground/70";
const IMAGE_ROW = "flex max-w-full flex-wrap gap-1.5";
const IMAGE = "chat-user-image block min-w-0 cursor-zoom-in overflow-hidden rounded-md border-0 bg-transparent p-0 transition-opacity hover:opacity-90 [&>img]:block [&>img]:size-20 [&>img]:object-cover";

function ChecklistView({ rows }: { rows: ChecklistRow[] }) {
  return <ul className={cn("chat-checklist", PLAN_LIST)}>{rows.map((row, index) => (
    <li key={index} className={row.heading ? PLAN_PHASE : cn(PLAN_ITEM, row.done ? "text-muted-foreground" : row.active ? "text-foreground" : "text-foreground/90")}>
      {!row.heading && <span className={cn("w-4 shrink-0", row.done ? "text-accent-add" : "text-muted-foreground")} aria-hidden="true">{row.done ? "✓" : "•"}</span>}{row.label}
    </li>
  ))}</ul>;
}

const TODO_ICONS: Record<TodoStatus, ComponentType<LucideProps>> = {
  completed: CircleCheck, in_progress: CircleDot, pending: Circle, blocked: CircleAlert, dropped: CircleSlash,
};
const TODO_TONE: Record<TodoStatus, { text: string; icon: string }> = {
  completed: { text: "text-muted-foreground", icon: "text-accent-add" },
  in_progress: { text: "text-foreground", icon: "text-foreground/70" },
  pending: { text: "text-foreground/90", icon: "text-muted-foreground/40" },
  blocked: { text: "text-foreground/90", icon: "text-destructive" },
  dropped: { text: "text-muted-foreground line-through", icon: "text-muted-foreground/40" },
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
  return <div className="todo-list flex flex-col gap-3">{groups.map((group, index) => (
    <div key={index} className="flex flex-col gap-1.5">
      {group.phase !== null && <p className={PLAN_PHASE}>{group.phase}</p>}
      <ul className={PLAN_LIST}>{group.items.map((item, row) => {
        const Icon = TODO_ICONS[item.status];
        return <li key={row} className={cn("todo-item", PLAN_ITEM, TODO_TONE[item.status].text)}>
          <Icon className={cn("mt-0.5 size-4 shrink-0", TODO_TONE[item.status].icon)} aria-hidden="true" />
          <span className="min-w-0 wrap-anywhere">{item.label}<span className="sr-only"> ({TODO_LABELS[item.status]})</span>{item.note && <span className="block text-ui text-muted-foreground">{item.note}</span>}</span>
        </li>;
      })}</ul>
    </div>
  ))}</div>;
}

const TOOL_TEXT = "overflow-x-auto rounded-md bg-surface-raised px-2.5 py-2 font-mono text-tool text-muted-foreground";
const TOOL_BOX = cn("chat-tool-io flex max-h-40 w-full flex-col gap-2 overflow-auto", TOOL_TEXT);
const TOOL_PRE = cn("chat-tool-io m-0 max-h-40 w-full overflow-auto whitespace-pre-wrap wrap-anywhere", TOOL_TEXT);
const INNER_PRE = "m-0 whitespace-pre-wrap wrap-anywhere";
const DIFF = "chat-diff m-0 block overflow-x-auto whitespace-pre";
const DIFF_ADD = "chat-diff-add text-accent-add";
const DIFF_DEL = "chat-diff-del text-destructive";
const DIFF_HEAD = "chat-diff-head font-medium text-muted-foreground/70";

function ompEditLineClass(line: string): string | undefined {
  if (line.startsWith("+-") || line.startsWith("-") || /^(CUT|REM)\b/.test(line)) return DIFF_DEL;
  if (line.startsWith("+")) return DIFF_ADD;
  if (/^(PUT|MV)/.test(line) || line.startsWith("[")) return DIFF_HEAD;
  return undefined;
}

function ToolFile({ path, suffix }: { path: string; suffix?: string }) {
  const t = useT();
  const open = useContext(OpenFileContext);
  if (open === null) return <p className="chat-tool-file m-0 text-foreground">{path}{suffix}</p>;
  return <p className="chat-tool-file m-0 text-foreground"><button type="button" className="chat-tool-file-link cursor-pointer border-0 bg-transparent p-0 text-left text-inherit underline decoration-dotted underline-offset-[0.2em] wrap-anywhere [font:inherit] hover:text-primary hover:decoration-solid" aria-label={t("Open {path}", { path })} onClick={() => open(path)}>{path}</button>{suffix}</p>;
}

function EditDiff({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after);
  return <pre className={DIFF}>{lines.map((line, index) =>
    <span key={index} className={line.kind === "add" ? DIFF_ADD : line.kind === "del" ? DIFF_DEL : undefined}>{line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}{line.text}{"\n"}</span>)}</pre>;
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
    line.startsWith("@@") || line.startsWith("*** Move to:") ? DIFF_HEAD : line.startsWith("+") ? DIFF_ADD : line.startsWith("-") ? DIFF_DEL : undefined;
  return <div className={TOOL_BOX}>{sections.map((section, index) => <div key={index}>
    {section.file !== null && <ToolFile path={section.file} suffix={section.action === "Update" ? undefined : ` (${section.action.toLowerCase()})`} />}
    {section.lines.length > 0 && <pre className={DIFF}>{section.lines.map((line, at) => <span key={at} className={lineClass(line)}>{line}{"\n"}</span>)}</pre>}
  </div>)}</div>;
}

function ToolInputView({ part }: { part: ToolPartType }) {
  const after = isTodoTool(part.name) ? parseTodoAnswer(part.output) : null;
  if (after !== null && after.length > 0) return <TodoList items={after} />;
  const patch = patchText(part.input);
  if (patch !== null) return <PatchView patch={patch} />;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(part.input) as Record<string, unknown>; }
  catch { return <pre className={TOOL_PRE}>{part.input}</pre>; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return <pre className={TOOL_PRE}>{part.input}</pre>;
  const str = (key: string): string | undefined => typeof parsed[key] === "string" ? parsed[key] : undefined;
  const command = str("command") ?? str("cmd");
  if (command !== undefined) return <div className={TOOL_BOX}><pre className={INNER_PRE}>{command}</pre>{(str("cwd") ?? str("description")) !== undefined && <p className="chat-tool-io-meta m-0 text-ui text-muted-foreground/60">{str("cwd") ?? str("description")}</p>}</div>;
  const oldString = str("old_string");
  const newString = str("new_string");
  if (oldString !== undefined || newString !== undefined) return <div className={TOOL_BOX}>{str("file_path") !== undefined && <ToolFile path={str("file_path")!} />}<EditDiff before={oldString ?? ""} after={newString ?? ""} /></div>;
  if (Array.isArray(parsed["edits"]) && parsed["edits"].every((item) => item !== null && typeof item === "object")) {
    const edits = parsed["edits"] as Array<Record<string, unknown>>;
    return <div className={TOOL_BOX}>{str("file_path") !== undefined && <ToolFile path={str("file_path")!} />}{edits.map((item, index) =>
      <EditDiff key={index} before={typeof item["old_string"] === "string" ? item["old_string"] : ""} after={typeof item["new_string"] === "string" ? item["new_string"] : ""} />)}</div>;
  }
  const editScript = str("input");
  if (editScript !== undefined) return <pre className={cn(TOOL_PRE, DIFF, "whitespace-pre")}>{editScript.split("\n").map((line, index) => <span key={index} className={ompEditLineClass(line)}>{line}{"\n"}</span>)}</pre>;
  const content = str("content");
  if (content !== undefined) return <div className={TOOL_BOX}>{(str("file_path") ?? str("path")) !== undefined && <ToolFile path={(str("file_path") ?? str("path"))!} />}<pre className={INNER_PRE}>{content}</pre></div>;
  const path = str("file_path") ?? str("path");
  if (path !== undefined) return <div className={TOOL_BOX}><ToolFile path={path} suffix={str("pattern") !== undefined ? `  /${str("pattern")}/` : undefined} /></div>;
  for (const [key, toRows] of [["list", phaseRows], ["todos", todoRows], ["plan", planRows], ["tasks", taskRows]] as const) {
    const value = parsed[key];
    if (Array.isArray(value)) {
      const rows = toRows(value);
      if (rows.length > 0) return <ChecklistView rows={rows} />;
    }
  }
  return <pre className={TOOL_PRE}>{part.input}</pre>;
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
  return <div className={cn("chat-tool-images", IMAGE_ROW)}>{part.images.map((image) => {
    const src = machinePath(machineId, `pane/conversation/image?${new URLSearchParams({ pane_id: paneId, ref: image.ref }).toString()}`);
    return <a key={image.ref} className={IMAGE} href={src} target="_blank" rel="noopener noreferrer" aria-label={t("Open image")}><img src={src} alt={t("Attached image")} loading="lazy" /></a>;
  })}</div>;
}

const ROW_CHEVRON = "size-3 shrink-0 text-muted-foreground transition-all";

const EVENT = "group/event";
const EVENT_SUMMARY = "flex w-full cursor-pointer list-none items-center gap-2 text-chat pointer-coarse:min-h-9 [&::-webkit-details-marker]:hidden";
const EVENT_LABEL = "shrink-0 text-foreground/80";
const EVENT_DETAIL = "mt-1.5 text-chat text-muted-foreground";
export const CHAT_EMPTY = "chat-empty flex min-h-32 flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground";
const JUMP = "sticky bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border-border shadow-sm";
const STATE_LINE = "chat-inline-state m-0 self-center text-ui text-muted-foreground";
const ENDCAP = "chat-endcap m-0 self-center text-ui text-muted-foreground/60";

function EventChevron() {
  return <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground opacity-0 transition-all group-hover/event:opacity-100 group-open/event:rotate-90 group-open/event:opacity-100" />;
}

function EventTime({ ts, time }: { ts: string | null; time: string | null }) {
  return time === null ? null : <time className="min-w-0 truncate text-muted-foreground" dateTime={ts ?? undefined}>{time}</time>;
}

function RowChevron({ open, group }: { open: boolean; group: "tool" | "think" | "turn" }) {
  const hover = { tool: "group-hover/tool:opacity-100", think: "group-hover/think:opacity-100", turn: "group-hover/turn:opacity-100" }[group];
  return <ChevronRight aria-hidden="true" className={cn(ROW_CHEVRON, open ? "rotate-90 opacity-100" : cn("opacity-0", hover))} />;
}

function WorkRow({ paneId, part }: { paneId: string; part: ToolPartType }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const whole = useWholeOutput(part.output_ref);
  const summary = todoCallSummary(part) ?? part.summary;
  const output = isTodoTool(part.name) && parseTodoAnswer(part.output) !== null ? "" : whole.text ?? part.output;
  return <div className={cn("work-row group/tool flex flex-col gap-1.5", part.error && "is-error")}>
    <button type="button" className="work-row-head cursor-pointer border-0 bg-transparent p-0 [font:inherit] flex w-full items-center gap-2 text-left text-chat pointer-coarse:min-h-9" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className={cn("shrink-0", part.error ? "text-destructive" : "text-foreground/80")}>{part.name}</span>
      {summary.length > 0 && summary !== part.name && <span className="min-w-0 max-w-fit truncate font-mono text-muted-foreground">{summary}</span>}
      {part.error && <span className="shrink-0 text-destructive">{t("failed")}</span>}
      <RowChevron open={open} group="tool" />
    </button>
    {open && <div className="work-row-detail flex flex-col gap-1.5"><ToolInputView part={part} /><ToolImages paneId={paneId} part={part} />{output.length > 0 && <section className="chat-tool-output flex flex-col gap-1">
      <h4 className="text-ui text-muted-foreground/70">{t(part.error ? "Error" : "Output")}</h4>
      <pre className={cn(TOOL_PRE, part.error && "text-destructive", whole.text !== null && "is-whole max-h-[60vh]")}>{output}</pre>
      {part.output_ref !== undefined && whole.text === null && <Button variant="ghost" size="xs" className="chat-tool-more self-start text-muted-foreground" disabled={whole.state === "loading"} onClick={whole.load}>
        {t(whole.state === "loading" ? "Loading the whole output…" : whole.state === "failed" ? "Couldn't load the whole output. Retry" : "Show the whole output ({size} characters)", { size: formatTokens(part.output_size ?? 0) })}
      </Button>}</section>}</div>}
  </div>;
}

function ThinkingRow({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <div className="work-row work-row-thinking">
    <button type="button" className="work-row-head cursor-pointer border-0 bg-transparent p-0 [font:inherit] group/think flex items-center gap-1.5 text-chat text-muted-foreground pointer-coarse:min-h-9" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>{t("Thought")}</span>
      <RowChevron open={open} group="think" />
    </button>
    {open && <p className="work-thinking-text mt-1 whitespace-pre-wrap wrap-anywhere text-chat text-muted-foreground italic">{text}</p>}
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
  return <section className={cn("work-block flex w-full flex-col gap-3", live && "is-live")}>
    <button type="button" className="work-block-head cursor-pointer border-0 bg-transparent p-0 [font:inherit] group/turn flex min-w-0 items-center gap-2 text-left text-chat text-muted-foreground pointer-coarse:min-h-9" aria-expanded={open} onClick={() => setOpen(!open)}>
      {live && <Orb state="listening" aria-hidden="true" className="shrink-0" />}
      <span className={cn("work-block-title shrink-0", live && "shimmer-text")}>{title}</span>
      {summary.length > 0 && <span className="work-block-summary min-w-0 truncate text-muted-foreground/60">{summary}</span>}
      <RowChevron open={open} group="turn" />
    </button>
    {open && <div className="work-block-rows flex flex-col gap-3">{visible.map((part, index) =>
      part.kind === "thinking" ? <ThinkingRow key={index} text={part.text} />
        : part.kind === "text" ? <div key={index} className="work-narration"><Markdown>{part.text}</Markdown></div>
          : part.kind === "tool" ? <WorkRow key={index} paneId={paneId} part={part} /> : null)}</div>}
  </section>;
}

function SkillActivityList({ parts, end = false }: { parts: ConversationPart[]; end?: boolean }) {
  const t = useT();
  const skills = turnSkills(parts);
  if (skills.length === 0) return null;
  return <div className={cn("chat-skills flex max-w-full flex-col gap-1.5", end ? "items-end" : "items-start")} role="group" aria-label={t("Skill activity")}>
    {skills.map((skill) => <details className={cn("chat-skill max-w-full", EVENT, skill.status === "failed" && "is-error")} key={`${skill.evidence}:${skill.path ?? skill.name}`}>
      <summary className={EVENT_SUMMARY}><span className={cn("chat-skill-name wrap-anywhere", EVENT_LABEL, skill.status === "failed" && "text-destructive")}>{skill.name}</span><span className="min-w-0 truncate text-muted-foreground">{
        skill.evidence === "invocation"
          ? skill.status === "failed" ? t("Skill invocation failed") : skill.status === "requested" ? t("Skill requested") : t("Skill invoked")
          : skill.status === "failed" ? t("Skill read failed") : skill.status === "requested" ? t("Reading skill requested") : t("Skill instructions loaded")
      }</span><EventChevron /></summary>
      <div className={cn(EVENT_DETAIL, "wrap-anywhere")}><p className="m-0 mb-1">{skill.evidence === "invocation" ? t("Recorded by the agent's Skill tool. This does not mean the skill's work is complete.") : t("The transcript records loading this skill's instructions. This does not confirm every step was followed.")}</p>
        {skill.path && <code className="font-mono text-code">{skill.path}</code>}
      </div>
    </details>)}
  </div>;
}

const GOAL_TONE: Record<GoalStatus, string> = {
  active: "text-foreground/80", paused: "text-muted-foreground", blocked: "text-destructive", complete: "text-accent-add", budget_limited: "text-destructive",
};

function GoalActivity({ goal }: { goal: GoalState }) {
  const t = useT();
  const word: Record<GoalStatus, string> = {
    active: t("in progress"), paused: t("paused"), blocked: t("blocked"), complete: t("complete"), budget_limited: t("out of budget"),
  };
  const spent = [
    goal.timeUsedSeconds !== null && goal.timeUsedSeconds > 0 ? formatGoalTime(goal.timeUsedSeconds) : null,
    goal.tokensUsed !== null && goal.tokensUsed > 0 ? t("{n} tokens", { n: formatTokens(goal.tokensUsed) }) : null,
  ].filter((item) => item !== null).join(" · ");
  return <details className={cn("chat-goal w-full min-w-0", EVENT)}>
    <summary className={EVENT_SUMMARY}><span className={EVENT_LABEL}>{t("Goal")}</span><span className="min-w-0 flex-1 truncate text-muted-foreground group-open/event:invisible">{goal.objective}</span>
      <span className={cn("shrink-0", GOAL_TONE[goal.status])}>{word[goal.status]}</span><EventChevron /></summary>
    <div className={cn(EVENT_DETAIL, "wrap-anywhere")}>
      <p className="m-0 mb-1 whitespace-pre-wrap text-foreground/90">{goal.objective}</p>
      {goal.blockedReason !== null && <p className="m-0 mb-1">{goal.blockedReason}</p>}
      {spent.length > 0 && <p className="m-0">{t("Used so far: {spent}", { spent })}</p>}
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
  return <div className={cn("chat-user-images justify-end", IMAGE_ROW)}>
    {pasted.map((part) => {
      const src = machinePath(machineId, `pane/conversation/image?${new URLSearchParams({ pane_id: paneId, ref: part.ref }).toString()}`);
      return <a key={part.ref} className={IMAGE} href={src} target="_blank" rel="noopener noreferrer" aria-label={t("Open image")}><img src={src} alt={t("Attached image")} loading="lazy" /></a>;
    })}
    {mentioned.map((path) => {
      const src = fileUrl(path, paneId, machineId);
      return open !== null
        ? <button key={path} type="button" className={IMAGE} aria-label={t("Open {path}", { path })} onClick={() => open(path)}><img src={src} alt={path} loading="lazy" /></button>
        : <a key={path} className={IMAGE} href={src} target="_blank" rel="noopener noreferrer" aria-label={path}><img src={src} alt={path} loading="lazy" /></a>;
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
    return <details className={cn("chat-compact", EVENT)}>
      <summary className={EVENT_SUMMARY}><span className={EVENT_LABEL}>{t("Conversation compacted")}</span><EventTime ts={turn.ts} time={time} /><EventChevron /></summary>
      <div className={EVENT_DETAIL}><Markdown>{compact.text}</Markdown></div>
    </details>;
  }
  const notice = turn.parts.find((part): part is Extract<ConversationPart, { kind: "notice" }> => part.kind === "notice");
  if (notice !== undefined) {
    return <details className={cn("chat-compact chat-notice", EVENT)}>
      <summary className={EVENT_SUMMARY}><span className={EVENT_LABEL}>{t("Background result delivered")}</span><EventTime ts={turn.ts} time={time} /><EventChevron /></summary>
      <pre className={cn(TOOL_PRE, "mt-1.5 max-h-[60vh]")}>{notice.text}</pre>
    </details>;
  }
  if (turn.role === "user") {
    const text = turn.parts.filter((part): part is Extract<ConversationPart, { kind: "text" }> => part.kind === "text").map((part) => part.text).join("\n\n");
    return <article className={cn(TURN, "chat-turn-user group/turn flex flex-col items-end gap-1.5")}>
      <UserImages paneId={paneId} parts={turn.parts} text={text} />
      {text.length > 0 && <div className="chat-bubble max-w-[85%] rounded-xl bg-card px-3 py-2 text-chat text-card-foreground shadow-(--shadow-card) wrap-anywhere"><Markdown>{text}</Markdown></div>}
      <SkillActivityList parts={turn.parts} end />
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
        <details className={cn("chat-compact chat-abandoned", EVENT)}>
          <summary className={EVENT_SUMMARY}><span className={cn(EVENT_LABEL, "min-w-0 shrink")}>{t(abandoned.branches > 1
            ? abandoned.count === 1 ? "{n} earlier turn on {b} branches you navigated away from" : "{n} earlier turns on {b} branches you navigated away from"
            : abandoned.count === 1 ? "{n} earlier turn on a branch you navigated away from" : "{n} earlier turns on a branch you navigated away from",
            { n: abandoned.count, b: abandoned.branches })}</span><EventChevron /></summary>
          {abandoned.summary !== null
            ? <div className={EVENT_DETAIL}><Markdown>{abandoned.summary}</Markdown></div>
            : <p className={cn(EVENT_DETAIL, "m-0 mt-1.5")}>{t("pi kept them in the session file but answers from the branch you chose. Use /tree in the terminal to go back.")}</p>}
        </details>
      )}
      {state.source === "conversation" && typeof olderCursor === "string" && (
        <Button variant="ghost" size="sm" className="chat-older self-center text-ui text-muted-foreground" disabled={olderState === "loading"} onClick={() => void loadOlder()}>
          {t(olderState === "loading" ? "Loading earlier messages…" : olderState === "failed" ? "Couldn't load earlier messages. Retry" : "Earlier messages")}
        </Button>
      )}
      {state.source === "conversation" && olderCursor === null && older.length > 0 && <p className={ENDCAP}>{t("beginning of conversation")}</p>}
      {state.source === "conversation"
        ? turns.map((turn, index) => {
            const last = index === turns.length - 1;
            return <RenderBoundary key={`${paneId}:${historyId ?? ""}:${turn.role}:${turn.ts ?? index}`} resetKey={turnRevision(turn)} fallback={() => <p className={cn(STATE_LINE, "text-destructive")}>{t("This message can't be shown here. The terminal has it.")}</p>}>
              <Turn paneId={paneId} turn={turn} live={isLiveWorkTurn(turn, last, agentStatus, finishedBeforeSend)} last={last} showThinking={settings.showThinking} />
            </RenderBoundary>;
          })
        : agent !== null
          ? <details className="chat-terminal-fallback text-ui text-muted-foreground"><summary className="cursor-pointer">{t("Conversation unavailable. Show terminal output")}</summary><pre className={INNER_PRE}>{state.messages.map((message) => message.text).join("\n\n")}</pre></details>
          : state.messages.map((message, index) => <FallbackTurn key={index} paneId={paneId} message={message} />)}
      {!ended && !connected && <p className={STATE_LINE}>{t("reconnecting…")}</p>}
      {error !== null && <p className={cn(STATE_LINE, "text-destructive")} role="alert">{errorStatus === 401 ? t("Locked: the token gate is asking again") : error}</p>}
      {!loaded && error === null && <p className={STATE_LINE} role="status">{t("Loading conversation…")}</p>}
      {loaded && empty && error === null && prompt === null && <div className={CHAT_EMPTY}><AgentMark agent={agent ?? "agent"} size={32} /><p className="m-0 text-ui">{t("No conversation yet. Say something below")}</p></div>}
      {prompt !== null && <PromptCard paneId={paneId} prompt={prompt} typedAnswer={pendingAnswer?.promptId === prompt.id ? pendingAnswer.answer : null} onTypedAnswerDone={onPendingAnswerDone} onPromptChanged={() => setPromptPollKey((key) => key + 1)} onAnswered={() => {
        setPrompt(null);
        if (prompt.steps) setPromptPollKey((key) => key + 1);
        onPendingAnswerDone?.();
      }} />}
      {ended && <p className={ENDCAP}>{t("terminal ended")}</p>}
    </div>
    {newMessages ? <Button variant="secondary" size="sm" className={cn(JUMP, "chat-new-messages px-3 pointer-coarse:h-10")} onClick={scrollToBottom}>{t("New messages")} <ArrowDown aria-hidden="true" /></Button>
      : away && <Button variant="secondary" size="icon-sm" className={cn(JUMP, "chat-new-messages pointer-coarse:size-10")} aria-label={t("Jump to latest")} onClick={scrollToBottom}><ArrowDown aria-hidden="true" /></Button>}
  </div>
  </ChatHistoryContext.Provider></ChatPaneContext.Provider>;
});
