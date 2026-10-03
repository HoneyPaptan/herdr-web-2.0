import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Clock, CornerDownLeft, FileText, Plus, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import "./Composer.css";

import type { AgentStatus, ConversationMetadata, SlashCommand } from "../../shared/protocol.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { composerDrafts } from "../lib/composerDraft.ts";
import { paneStorageId } from "../../shared/machines.ts";
import {
  agentDisplayLabel,
  composerStatusWord,
  contextLeftPercent,
  formatTokens,
  imageMention,
  insertMention,
  MAX_COMPOSER_CHARS,
  rankSlashCommands,
  terminalOnlyCommand,
} from "../lib/compose.ts";
import { activeTrigger, applyCompletion, type ActiveTrigger } from "../lib/mentions.ts";
import { quickReplyButtons, useSettings } from "../lib/settings.ts";
import { BackgroundTasks } from "./BackgroundTasks.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { Orb } from "./Orb.tsx";
import { MicButton, VoiceRecordingPill, useDictation } from "./VoiceInput.tsx";
import { useT } from "../lib/i18n.ts";

export interface ComposerProps {
  connected: boolean;
  paneId: string;
  autoFocus?: boolean;
  agent: string | null;
  agentStatus?: AgentStatus;
  backgroundTasks?: number;
  metadata?: ConversationMetadata | null;
  queueMode?: boolean;
  answerHint?: string | null;
  suggestion?: string | null;
  onSend: (text: string) => boolean | string | Promise<boolean | string>;
  onCommand: (text: string) => boolean | string | Promise<boolean | string>;
  onAbort: () => void;
  onUploadImage: (file: File) => Promise<string>;
}

const MAX_IMAGES_PER_ACTION = 4;
const PREVIEW_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] as const;
const COMMAND_CACHE_MS = 60_000;
const SLASH_USAGE_KEY = "herdr-web-ui:slash-usage";
const COMMAND_SOURCES = ["builtin", "user", "project", "skill", "plugin"] as const;
export const SOURCE_LABEL: Record<SlashCommand["source"], string> = {
  builtin: "Built in",
  user: "User",
  project: "Project",
  skill: "Skills",
  plugin: "Plugins",
};

type CommandCacheEntry = { loadedAt: number; commands: SlashCommand[] };
const commandCache = new Map<string, CommandCacheEntry>();
let attachmentSequence = 0;

type Attachment = {
  id: number;
  file: File;
  previewUrl: string;
  path: string | null;
  state: "uploading" | "ready" | "error";
};

function readSlashUsage(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SLASH_USAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
    );
  } catch {
    return {};
  }
}

async function cachedPaneCommands(paneId: string, machineId: string, fetchCommands: (pane: string) => Promise<SlashCommand[]>): Promise<SlashCommand[]> {
  const cached = commandCache.get(paneStorageId(machineId, paneId));
  if (cached && Date.now() - cached.loadedAt < COMMAND_CACHE_MS) return cached.commands;
  const commands = await fetchCommands(paneId);
  commandCache.set(paneStorageId(machineId, paneId), { loadedAt: Date.now(), commands });
  return commands;
}

const COMPOSER_COLUMN = "mx-auto w-[min(100%,var(--content-w))]";
const COMPOSER_CARD = "composer-surface relative rounded-2xl border border-edge-surface bg-composer shadow-(--shadow-surface) backdrop-blur-xl transition-colors focus-within:border-ring data-dragging:border-ring";
const COMPOSER_INPUT = "composer-text max-h-[10lh] min-h-7 min-w-0 flex-1 resize-none overflow-y-auto px-1 py-1 text-prompt leading-normal text-foreground outline-none placeholder:text-muted-foreground";
const QUICK_ROW = cn(COMPOSER_COLUMN, "mb-2 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden");
const QUICK_REPLY = "max-w-[16em] shrink-0 justify-start rounded-full border-border px-3 text-ui pointer-coarse:h-9";
const PICKER_ROW = "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2 text-left text-ui text-foreground [font:inherit] aria-selected:bg-accent aria-selected:text-accent-foreground pointer-coarse:h-10";
const PICKER_GROUP = "[&+&]:mt-2 [&+&]:border-t [&+&]:border-dotted [&+&]:border-border/40 [&+&]:pt-2";
const PICKER_LABEL = "px-2 pb-0.5 text-ui text-muted-foreground/50";
const ATTACHMENT = "group relative shrink-0";
const ATTACHMENT_FACE = "size-14 rounded-lg border border-hairline-strong bg-card object-cover";
const ATTACHMENT_FILE = "flex h-14 max-w-56 items-center gap-2 rounded-lg border border-hairline-strong bg-card px-2.5";
const ATTACHMENT_STATE = "pointer-events-none absolute inset-x-1 bottom-1 truncate rounded-full bg-popover px-1 text-center text-[0.7rem] leading-tight text-foreground";
const ATTACHMENT_REMOVE = "absolute -top-1.5 -right-1.5 flex cursor-pointer items-center justify-center rounded-full border border-border bg-secondary p-0.5 text-secondary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:size-7";
const COMPOSER_LINE = cn(COMPOSER_COLUMN, "mt-1 px-2 text-ui");
const ROUND_ACTION = "shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:opacity-100 pointer-coarse:size-9";
const RING_STROKE = "fill-none [stroke-width:2.5]";

function ContextRing({ context }: { context: NonNullable<ConversationMetadata["context"]> }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const left = contextLeftPercent(context);
  if (left === null || context.window === null) return null;
  const label = t("Context {percent}% left", { percent: left });
  const detail = t("{used} of {window} tokens", { used: formatTokens(context.used), window: formatTokens(context.window) });
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("composer-context ml-auto min-w-0 gap-1 px-1.5 text-ui tabular-nums text-muted-foreground/60", left <= 20 && "text-(--status-blocked)")}
      aria-label={`${label} · ${detail}`}
      title={`${label} · ${detail}`}
      aria-expanded={shown}
      onClick={() => setShown((open) => !open)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 shrink-0">
        <circle className={cn(RING_STROKE, "stroke-border")} cx="8" cy="8" r={radius} />
        <circle className={cn(RING_STROKE, "stroke-current [stroke-linecap:round]")} cx="8" cy="8" r={radius}
          strokeDasharray={`${circumference * (100 - left) / 100} ${circumference}`} transform="rotate(-90 8 8)" />
      </svg>
      {shown && <span className="min-w-0 truncate">{label}</span>}
    </Button>
  );
}

function PickerHint() {
  const t = useT();
  return (
    <div aria-hidden="true" className="mb-1.5 flex items-center gap-3 self-start rounded-lg bg-background px-1.5 py-1 text-ui text-muted-foreground/50 pointer-coarse:hidden">
      <KbdGroup><Kbd>↑</Kbd><Kbd>↓</Kbd><span className="ml-0.5">{t("navigate")}</span></KbdGroup>
      <KbdGroup><Kbd><CornerDownLeft strokeWidth={2} /></Kbd><span className="ml-0.5">{t("select")}</span></KbdGroup>
    </div>
  );
}

function PickerLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col p-1">
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="flex h-8 items-center gap-2 px-2">
          <span className="size-3.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
          <span className="h-3 w-14 shrink-0 animate-pulse rounded bg-muted-foreground/20" />
          <span className="h-3 w-32 animate-pulse rounded bg-muted-foreground/10" />
        </div>
      ))}
    </div>
  );
}

export function Composer({
  connected,
  paneId,
  autoFocus = true,
  agent,
  agentStatus,
  backgroundTasks = 0,
  metadata,
  queueMode = false,
  answerHint = null,
  suggestion = null,
  onSend,
  onCommand,
  onAbort,
  onUploadImage,
}: ComposerProps) {
  const t = useT();
  const machineId = useMachineId();
  const { fetchPaneCommands, fetchPaneFiles } = useMachineApi();
  const { settings } = useSettings();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentsRef = useRef<Attachment[]>([]);
  const removedAttachments = useRef(new Set<number>());
  const fileRequest = useRef(0);
  const draftKey = `herdr-web-ui:composer-draft:${paneStorageId(machineId, paneId)}`;
  const { text, sending } = useSyncExternalStore(composerDrafts.subscribe, () => composerDrafts.read(draftKey));
  const setText = useCallback((value: string | ((previous: string) => string)) => composerDrafts.set(draftKey, value), [draftKey]);
  const mounted = useRef(true);
  const [caret, setCaret] = useState(text.length);
  const textRef = useRef(text);
  const caretRef = useRef(caret);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [slashUsage, setSlashUsage] = useState<Record<string, number>>(readSlashUsage);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const quickOpen = settings.showQuickReplies;
  const quickReplies = quickReplyButtons(settings);

  attachmentsRef.current = attachments;
  textRef.current = text;
  caretRef.current = caret;
  const trigger = useMemo(() => activeTrigger(text, caret, { skills: agent === "codex" }), [agent, caret, text]);
  const terminalOnly = useMemo(() => terminalOnlyCommand(agent, text), [agent, text]);
  const uploading = attachments.some((attachment) => attachment.state === "uploading");
  const agentLabel = agentDisplayLabel(agent);
  const offered = connected && answerHint === null && suggestion !== null ? suggestion : null;
  const placeholder = !connected
    ? t("Reconnecting… message held here, never queued")
    : answerHint ?? offered ?? t("Message {agent}…", { agent: agentLabel });

  useEffect(() => {
    let live = true;
    void cachedPaneCommands(paneId, machineId, fetchPaneCommands)
      .then((next) => {
        if (live) setCommands(next);
      })
      .catch(() => {
        if (live) setCommands([]);
      });
    return () => {
      live = false;
    };
  }, [paneId]);

  useEffect(() => {
    const request = ++fileRequest.current;
    if (trigger?.kind !== "file") {
      setFiles([]);
      setFilesLoading(false);
      return;
    }
    setFilesLoading(true);
    const timer = window.setTimeout(() => {
      void fetchPaneFiles(paneId, trigger.query, 20)
        .then((next) => {
          if (request === fileRequest.current) setFiles(next);
        })
        .catch(() => {
          if (request === fileRequest.current) setFiles([]);
        })
        .finally(() => {
          if (request === fileRequest.current) setFilesLoading(false);
        });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [paneId, trigger?.kind, trigger?.query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [trigger?.kind, trigger?.query]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const attachment of attachmentsRef.current) URL.revokeObjectURL(attachment.previewUrl);
    };
  }, []);

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text, placeholder]);


  const filteredCommands = useMemo(
    () => (trigger?.kind === "slash"
      ? rankSlashCommands(commands.filter((command) => (command.trigger ?? "/") === (trigger.prefix ?? "/")), trigger.query, slashUsage)
      : []),
    [commands, slashUsage, trigger],
  );
  const orderedCommands = useMemo(
    () => COMMAND_SOURCES.flatMap((source) => filteredCommands.filter((command) => command.source === source)),
    [filteredCommands],
  );
  const choices: readonly (SlashCommand | string)[] = trigger?.kind === "slash" ? orderedCommands : files;
  const pickerShown = !menuDismissed && trigger !== null;
  const menuOpen = pickerShown && choices.length > 0;
  const pickerLoading = pickerShown && trigger.kind === "file" && filesLoading && files.length === 0;

  useEffect(() => {
    if (selectedIndex >= choices.length) setSelectedIndex(Math.max(0, choices.length - 1));
  }, [choices.length, selectedIndex]);

  const dictation = useDictation({
    mode: "chat",
    connected,
    polish: settings.voicePolishChat,
    keywords: () => [...(agent ? [agentLabel] : []), ...commands.map((command) => command.name)],
    box: textareaRef,
    read: () => textRef.current,
    maxLength: MAX_COMPOSER_CHARS,
    write: (value, at) => {
      textRef.current = value;
      caretRef.current = at;
      setText(value);
      setCaret(at);
      requestAnimationFrame(() => {
        const element = textareaRef.current;
        if (element) element.selectionStart = element.selectionEnd = at;
      });
    },
    onNote: setNote,
  });

  const setTextAndCaret = useCallback((nextText: string, nextCaret: number) => {
    const limitedText = nextText.slice(0, MAX_COMPOSER_CHARS);
    const clampedCaret = Math.min(nextCaret, MAX_COMPOSER_CHARS);
    textRef.current = limitedText;
    caretRef.current = clampedCaret;
    setText(limitedText);
    setCaret(clampedCaret);
    setMenuDismissed(false);
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.selectionStart = element.selectionEnd = clampedCaret;
      element.focus();
    });
  }, []);

  const insertMentionAtCursor = useCallback(
    (mention: string) => {
      const element = textareaRef.current;
      const currentText = textRef.current;
      const selectionIsCurrent = element?.value === currentText;
      const start = selectionIsCurrent ? (element.selectionStart ?? caretRef.current) : caretRef.current;
      const end = selectionIsCurrent ? (element.selectionEnd ?? start) : start;
      const next = insertMention(currentText, start, end, mention);
      setTextAndCaret(next.text, next.caret);
    },
    [setTextAndCaret],
  );

  const selectCompletion = useCallback(
    (choice: SlashCommand | string, currentTrigger: ActiveTrigger) => {
      const replacement = currentTrigger.kind === "slash" ? `${currentTrigger.prefix ?? "/"}${(choice as SlashCommand).name} ` : `@${choice as string} `;
      const completed = applyCompletion(text, currentTrigger, replacement);
      setTextAndCaret(completed.text, completed.caret);
      setMenuDismissed(true);
      if (currentTrigger.kind === "slash") {
        const name = (choice as SlashCommand).name;
        setSlashUsage((current) => {
          const next = { ...current, [name]: (current[name] ?? 0) + 1 };
          try {
            window.localStorage.setItem(SLASH_USAGE_KEY, JSON.stringify(next));
          } catch {
          }
          return next;
        });
      }
    },
    [setTextAndCaret, text],
  );

  const uploadImages = useCallback(
    async (incoming: readonly File[]) => {
      const images = incoming.slice(0, MAX_IMAGES_PER_ACTION);
      if (images.length === 0) return;

      const added = images.map<Attachment>((file) => ({
        id: ++attachmentSequence,
        file,
        previewUrl: (PREVIEW_TYPES as readonly string[]).includes(file.type) ? URL.createObjectURL(file) : "",
        path: null,
        state: "uploading",
      }));
      setAttachments((current) => [...current, ...added]);
      setNote(null);

      for (const attachment of added) {
        if (!mounted.current) break;
        try {
          const path = await onUploadImage(attachment.file);
          if (!mounted.current) break;
          if (removedAttachments.current.has(attachment.id)) continue;
          setAttachments((current) =>
            current.map((item) => (item.id === attachment.id ? { ...item, path, state: "ready" } : item)),
          );
          insertMentionAtCursor(imageMention(path));
        } catch (error) {
          if (!mounted.current) break;
          if (removedAttachments.current.has(attachment.id)) continue;
          setAttachments((current) =>
            current.map((item) => (item.id === attachment.id ? { ...item, state: "error" } : item)),
          );
          setNote(error instanceof Error ? error.message : String(error));
        }
      }
    },
    [insertMentionAtCursor, onUploadImage],
  );

  const removeAttachment = useCallback((attachment: Attachment) => {
    removedAttachments.current.add(attachment.id);
    URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    if (attachment.path) {
      const mention = imageMention(attachment.path);
      setText((current) => {
        const next = current.replace(mention, "");
        textRef.current = next;
        caretRef.current = Math.min(caretRef.current, next.length);
        return next;
      });
    }
  }, []);

  const send = useCallback(() => {
    if (composingRef.current) return;
    if (!connected || uploading || sending || text.trim().length === 0) return;
    const sent = text;
    const sentAttachments = attachments;
    const settle = (result: boolean | string): void => {
      const acknowledged = result === true ? composerDrafts.settle(draftKey, sent) : null;
      if (!mounted.current) return;
      if (typeof result === "string") setNote(result);
      if (acknowledged === null) return;
      const { text: rest, edited } = acknowledged;
      setCaret(rest.length);
      textRef.current = rest;
      caretRef.current = rest.length;
      setNote(edited ? t("Sent as it was. Your changes made while it was sending stayed here and were not sent.") : null);
      for (const attachment of sentAttachments) URL.revokeObjectURL(attachment.previewUrl);
      setAttachments((current) => current.filter((attachment) => !sentAttachments.includes(attachment)));
    };
    if (!composerDrafts.begin(draftKey, sent)) return;
    dictation.forget();
    try {
      const result = onSend(text);
      if (!(result instanceof Promise)) { settle(result); composerDrafts.end(draftKey); return; }
      void result.then(settle).catch(() => { if (mounted.current) setNote(t("Not confirmed. Check the terminal before sending again.")); }).finally(() => composerDrafts.end(draftKey));
    } catch {
      composerDrafts.end(draftKey);
      if (mounted.current) setNote(t("Not confirmed. Check the terminal before sending again."));
    }
  }, [attachments, connected, dictation.forget, draftKey, onSend, sending, text, uploading]);

  const sendWith = useCallback((send: (text: string) => boolean | string | Promise<boolean | string>, reply: string) => {
    if (!connected || sending) return;
    setNote(null);
    const settle = (result: boolean | string): void => {
      if (mounted.current && typeof result === "string") setNote(result);
    };
    if (!composerDrafts.begin(draftKey)) return;
    try {
      const result = send(reply);
      if (!(result instanceof Promise)) { settle(result); composerDrafts.end(draftKey); return; }
      void result.then(settle).catch(() => { if (mounted.current) setNote(t("Not confirmed. Check the terminal before sending again.")); }).finally(() => composerDrafts.end(draftKey));
    } catch {
      composerDrafts.end(draftKey);
      if (mounted.current) setNote(t("Not confirmed. Check the terminal before sending again."));
    }
  }, [connected, draftKey, sending]);
  const sendQuick = useCallback((reply: string) => sendWith(onSend, reply), [onSend, sendWith]);
  const runCommand = useCallback((command: string) => sendWith(onCommand, command), [onCommand, sendWith]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (menuOpen && trigger) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setSelectedIndex((current) => (current + direction + choices.length) % choices.length);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const choice = choices[selectedIndex];
          if (choice !== undefined) selectCompletion(choice, trigger);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setMenuDismissed(true);
          return;
        }
      }
      if (event.key === "Escape" && trigger) {
        setMenuDismissed(true);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey && offered !== null && textRef.current === "") {
        event.preventDefault();
        setTextAndCaret(offered, offered.length);
        return;
      }
      if (event.key !== "Enter") return;
      const shouldSend = settings.enterSends
        ? !event.shiftKey && !event.metaKey && !event.ctrlKey
        : (event.metaKey || event.ctrlKey) && !event.shiftKey;
      if (!shouldSend) return;
      event.preventDefault();
      send();
    },
    [choices, menuOpen, offered, selectCompletion, selectedIndex, send, setTextAndCaret, settings.enterSends, trigger],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (images.length === 0) return;
      event.preventDefault();
      void uploadImages(images);
    },
    [uploadImages],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      void uploadImages(Array.from(event.dataTransfer.files));
    },
    [uploadImages],
  );

  const isWorking = agentStatus === "working";
  const menuId = `composer-menu-${paneId}`;

  return (
    <div className="composer relative w-full flex-none bg-background px-4 pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)-1rem))] in-data-keyboard:pb-2 max-[480px]:px-2" role="group" aria-label={t("Message composer")}>
      {settings.showSuggestionChip && offered !== null && text === "" && (
        <div className={cn(QUICK_ROW, "pointer-fine:hidden")}>
          <Button variant="outline" size="sm" className={cn(QUICK_REPLY, "max-w-full border-dashed text-muted-foreground")} aria-label={t("Use the suggestion")} onClick={() => setTextAndCaret(offered, offered.length)}>
            <span className="truncate">{offered}</span>
          </Button>
        </div>
      )}

      {quickOpen && quickReplies.length > 0 && (
        <div className={QUICK_ROW} role="group" aria-label={t("Quick replies")}>
          {quickReplies.map((reply, index) => (
            <Button
              key={`${index}:${reply}`}
              variant="outline"
              size="sm"
              className={QUICK_REPLY}
              aria-label={t("Send “{reply}”", { reply })}
              disabled={!connected || sending}
              onClick={() => sendQuick(reply)}
            >
              <span className="truncate">{reply}</span>
            </Button>
          ))}
        </div>
      )}

      <div className={cn(COMPOSER_COLUMN, "relative")}>
        {pickerShown && trigger && (
          <div className="absolute bottom-full left-0 z-50 mb-1.5 flex w-full flex-col">
            {menuOpen && <PickerHint />}
            <div className="overflow-hidden rounded-xl border border-hairline-strong bg-picker text-popover-foreground shadow-md backdrop-blur-lg">
              {menuOpen ? (
              <div id={menuId} className="flex max-h-[14.5rem] flex-col overflow-x-hidden overflow-y-auto overscroll-contain p-1 [scrollbar-width:none]" role="listbox" aria-label={t(trigger.kind === "slash" ? "Slash commands" : "Files")}>
                {trigger.kind === "slash" ? (
                  COMMAND_SOURCES.map((source) => {
                    const group = filteredCommands.filter((command) => command.source === source);
                    if (group.length === 0) return null;
                    return (
                      <div className={PICKER_GROUP} key={source}>
                        <div className={PICKER_LABEL}>{t(SOURCE_LABEL[source])}</div>
                        {group.map((command) => {
                          const index = orderedCommands.indexOf(command);
                          return (
                            <button
                              id={`${menuId}-${index}`}
                              key={`${command.source}:${command.name}`}
                              type="button"
                              className={PICKER_ROW}
                              role="option"
                              aria-selected={index === selectedIndex}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => selectCompletion(command, trigger)}
                            >
                              <span className="shrink-0 font-medium">{command.trigger ?? "/"}{command.name}</span>
                              <span className="min-w-0 truncate text-muted-foreground">{command.description}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                ) : (
                  <div className={PICKER_GROUP}>
                    <div className={PICKER_LABEL}>{t("Files")}</div>
                    {files.map((file, index) => (
                      <button
                        id={`${menuId}-${index}`}
                        key={file}
                        type="button"
                        className={PICKER_ROW}
                        role="option"
                        aria-selected={index === selectedIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectCompletion(file, trigger)}
                      >
                        <span className="min-w-0 truncate">{file}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              ) : pickerLoading ? (
                <PickerLoading label={t("Loading files")} />
              ) : (
                <div role="status" className="flex h-8 items-center px-3 text-ui text-muted-foreground">{t(trigger.kind === "slash" ? "No matching commands" : "No matching files")}</div>
              )}
            </div>
          </div>
        )}

        <div
          data-slot="composer-card"
          data-dragging={dragging || undefined}
          className={COMPOSER_CARD}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          {attachments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label={t("Attached files")}>
              {attachments.map((attachment) => (
                <div className={ATTACHMENT} key={attachment.id}>
                  {attachment.previewUrl ? <img className={cn(ATTACHMENT_FACE, attachment.state === "error" && "border-destructive")} src={attachment.previewUrl} alt={attachment.file.name} />
                    : <span className={cn(ATTACHMENT_FILE, attachment.state === "error" && "border-destructive")}><FileText aria-hidden="true" className="size-5 shrink-0" /><span className="min-w-0 truncate text-ui">{attachment.file.name}</span></span>}
                  <span className={ATTACHMENT_STATE}>
                    {t(attachment.state === "uploading" ? "Uploading" : attachment.state === "error" ? "Failed" : "Attached")}
                  </span>
                  <button type="button" className={ATTACHMENT_REMOVE} aria-label={t("Remove {file}", { file: attachment.file.name })} onClick={() => removeAttachment(attachment)}>
                    <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-1 p-3 pointer-coarse:p-2">
            <textarea
              ref={textareaRef}
              data-slot="composer-input"
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              className={COMPOSER_INPUT}
              rows={1}
              maxLength={MAX_COMPOSER_CHARS}
              value={text}
              placeholder={placeholder}
              aria-label={t("Message")}
              aria-controls={menuOpen ? menuId : undefined}
              aria-expanded={menuOpen}
              aria-activedescendant={menuOpen ? `${menuId}-${selectedIndex}` : undefined}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onPaste={onPaste}
              onKeyDown={onKeyDown}
              onClick={(event) => {
                setCaret(event.currentTarget.selectionStart);
                setMenuDismissed(false);
              }}
              onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
              onChange={(event) => {
                setText(event.target.value);
                setCaret(event.target.selectionStart);
                setMenuDismissed(false);
                setNote(null);
              }}
            />
            {dictation.shown && <MicButton dictation={dictation} />}
            {queueMode && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full text-ui pointer-coarse:h-9"
                aria-label={t("Queue message")}
                disabled={!connected || uploading || sending || text.trim().length === 0}
                onClick={send}
              >
                <Clock />
                {t("Queue")}
              </Button>
            )}
            {isWorking ? (
              <Button size="icon-sm" className={ROUND_ACTION} aria-label={t("Stop agent")} disabled={!connected} onClick={onAbort}>
                <Square className="fill-current" />
              </Button>
            ) : !queueMode ? (
              <Button
                size="icon-sm"
                className={ROUND_ACTION}
                aria-label={t("Send message")}
                disabled={!connected || uploading || sending || text.trim().length === 0}
                onClick={send}
              >
                <ArrowUp strokeWidth={2} />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div
        data-slot="composer-toolbar"
        className="composer-status mx-auto flex w-[min(100%,var(--content-w))] min-w-0 items-center gap-0.5 px-1 pt-1.5"
        role="status"
        data-status={agentStatus ?? "unknown"}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void uploadImages(picked);
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground pointer-coarse:size-9"
          aria-label={t("Attach files")}
          disabled={!connected || uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus />
        </Button>
        <ModelPicker
          agent={agent}
          agentLabel={agentLabel}
          model={metadata?.model ?? null}
          effort={metadata?.reasoning_effort ?? null}
          disabled={!connected || sending || isWorking}
          onCommand={runCommand}
        />
        <span className={cn("inline-flex shrink-0 items-center gap-1 px-1.5 text-ui", agentStatus === "blocked" ? "text-accent-command" : "text-muted-foreground")}>
          {isWorking && <Orb state="listening" aria-hidden="true" className="shrink-0" />}
          {t(composerStatusWord(agentStatus))}
        </span>
        <BackgroundTasks paneId={paneId} count={backgroundTasks} omo={agent === "omo"} />
        {(uploading || !connected) && (
          <span className="min-w-0 truncate px-1.5 text-ui text-muted-foreground/60 max-[480px]:hidden">
            {t(uploading ? "Uploading file…" : "Reconnecting… message held here, never queued")}
          </span>
        )}
        {metadata?.context && <ContextRing context={metadata.context} />}
      </div>

      {note && <div className={cn(COMPOSER_LINE, "text-destructive")} role="alert">{note}</div>}
      {!note && terminalOnly !== null && (
        <div className={cn(COMPOSER_LINE, "text-muted-foreground")}>{t("{command} opens a tree the chat cannot show. It runs in the terminal. Tap the terminal button at the top of the screen to choose a branch.", { command: `/${terminalOnly}` })}</div>
      )}
      {dictation.shown && <VoiceRecordingPill dictation={dictation} align="start" />}
    </div>
  );
}
