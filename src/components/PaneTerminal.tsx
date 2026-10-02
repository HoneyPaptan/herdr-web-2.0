import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { TriangleAlert } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import "./PaneTerminal.css";

import { HerdrSocket } from "../lib/ws.ts";
import { controlCode, isPrintable, keySequence, type KeyBarKey } from "../lib/keys.ts";
import { EMPTY_DRAFT, applyToDraft, draftIsEmpty, type InputDraft } from "../lib/draft.ts";
import { messageQueues } from "../lib/messageQueue.ts";
import { MAX_COMPOSER_CHARS, QUEUE_READY_STATUS, composerMessage, composerPayload, submitNote } from "../lib/compose.ts";
import { answerFromText, answerHint, answerRefusal, needsConfirmation, type TypedAnswer } from "../lib/promptAnswer.ts";
import { ApiError, fetchPaneScroll, fetchPaneSelection, scrollPane } from "../lib/api.ts";
import { parseOsc52 } from "../lib/osc52.ts";
import { matchHerdrWidths } from "../lib/terminalWidths.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { paneStorageId } from "../../shared/machines.ts";
import { KeyBar } from "./KeyBar.tsx";
import { TerminalInput } from "./TerminalInput.tsx";
import { SecretInput } from "./SecretInput.tsx";
import { secretPrompt } from "../../shared/secret-prompt.ts";
import { CHAT_EMPTY, ChatView } from "./ChatView.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { Composer } from "./Composer.tsx";
import { Button } from "@/components/ui/button";
import type { AgentStatus, ClientRole, ConversationMetadata, InteractivePrompt, ServerMessage } from "../../shared/protocol.ts";
import type { PaneView } from "../lib/actions.ts";
import { useSettings, type Palette, type ResolvedTheme } from "../lib/settings.ts";
import { TERMINAL_MIN_CONTRAST, terminalTheme } from "../lib/theme.ts";
import { loadFontStack, terminalBootStack, terminalFontStack } from "../lib/fontFamily.ts";
import { registerHostFonts } from "../lib/hostFonts.ts";
import { useT } from "../lib/i18n.ts";
import { isAppShortcut } from "../lib/shortcuts.ts";
import { OpenFileContext } from "../lib/filePaths.ts";
import { fileUriPath, terminalFileLinkProvider } from "../lib/terminalFileLinks.ts";
import { startTerminalRenderer } from "../lib/terminalRenderer.ts";

const RESIZE_SETTLE_MS = 120;

export interface PaneTerminalProps {
  paneId: string | null;
  restoreError?: string | null;
  agent?: string | null;
  agentStatus?: AgentStatus;
  backgroundTasks?: number;
  view: PaneView;
  autoSelected?: boolean;
  terminalFontSize: number;
  terminalWheelSpeed: number;
  terminalFontFamily: string;
  terminalGpu: boolean;
  theme: ResolvedTheme;
  palette: Palette;
  role?: ClientRole;
  onRoleAck?: (mode: ClientRole) => void;
  onConnectionChange?: (connected: boolean) => void;
  onServerMessage?: (message: ServerMessage) => void;
}


const DIRECT_TYPING_KEY = "herdr-web-ui:direct-typing";

function storedDirectTyping(): boolean {
  try { return window.localStorage.getItem(DIRECT_TYPING_KEY) === "1"; } catch { return false; }
}

function useCoarsePointer(): boolean {
  const query = "(pointer: coarse)";
  const [coarse, setCoarse] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = (): void => setCoarse(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
export function PaneTerminal({
  paneId,
  restoreError = null,
  agent = null,
  agentStatus,
  backgroundTasks = 0,
  view,
  autoSelected = false,
  terminalFontSize,
  terminalWheelSpeed,
  terminalFontFamily,
  terminalGpu,
  theme,
  palette,
  role = "interact",
  onRoleAck,
  onConnectionChange,
  onServerMessage,
}: PaneTerminalProps) {
  const t = useT();
  const openFile = useContext(OpenFileContext);
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  const machineId = useMachineId();
  const { answerPanePrompt, uploadPaneImage } = useMachineApi();
  const uploadFileRef = useRef(uploadPaneImage);
  uploadFileRef.current = uploadPaneImage;
  const chatView = view === "chat";
  const chatViewRef = useRef(chatView);
  chatViewRef.current = chatView;
  const wheelSpeedRef = useRef(terminalWheelSpeed);
  wheelSpeedRef.current = terminalWheelSpeed;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<HerdrSocket | null>(null);
  const paneRef = useRef<string | null>(paneId);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onServerMessageRef = useRef(onServerMessage);
  const onRoleAckRef = useRef(onRoleAck);
  const [connected, setConnected] = useState(false);
  const [outputReady, setOutputReady] = useState(false);
  const [ended, setEnded] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [inputReady, setInputReady] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [held, setHeldState] = useState(false);
  const heldRef = useRef(false);
  const setHeld = useCallback((next: boolean) => { heldRef.current = next; setHeldState(next); }, []);
  const composingRef = useRef(false);
  const [composing, setComposingState] = useState(false);
  const setComposing = useCallback((active: boolean) => { composingRef.current = active; setComposingState(active); }, []);
  const ctrlRef = useRef(false);
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const observeRef = useRef(false);
  const fixedGridRef = useRef(false);
  const [observing, setObserving] = useState(false);
  const [secret, setSecret] = useState<{ pane: string; prompt: string } | null>(null);
  const secretRef = useRef<string | null>(null);
  const secretActive = secret !== null && secret.pane === paneId;
  const coarse = useCoarsePointer();
  const coarseRef = useRef(coarse); coarseRef.current = coarse;
  const { settings, update: updateSettings } = useSettings();
  const shortcutSettings = useRef(settings.shortcutOverrides);
  shortcutSettings.current = settings.shortcutOverrides;
  const directTyping = settings.terminalInputMode === "direct" || (settings.terminalInputMode === "auto" && (!coarse || storedDirectTyping()));
  const inputLine = !directTyping && !chatView;
  const inputLineRef = useRef(inputLine);
  inputLineRef.current = inputLine;
  const [draftState, setDraftState] = useState<{ owner: string | null; value: InputDraft }>({ owner: null, value: EMPTY_DRAFT });
  const draft = draftState.value;
  const setDraft = useCallback((value: InputDraft | ((previous: InputDraft) => InputDraft)) => {
    const owner = paneRef.current ? paneStorageId(machineId, paneRef.current) : null;
    setDraftState((previous) => ({ owner, value: typeof value === "function" ? value(previous.owner === owner ? previous.value : EMPTY_DRAFT) : value }));
  }, [machineId]);
  const draftPaneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!paneId || draftState.owner !== paneStorageId(machineId, paneId)) return;
    const key = `herdr-web-ui:terminal-draft:${draftState.owner}`;
    try { if (draftIsEmpty(draft)) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(draft)); } catch {}
  }, [draftState, paneId, machineId, draft]);
  const [clipboardNote, setClipboardNote] = useState<string | null>(null);
  const clipboardTimerRef = useRef<number | null>(null);
  const [chatRefresh, setChatRefresh] = useState(0);
  const [chatSent, setChatSent] = useState(0);
  const [chatMetadata, setChatMetadata] = useState<{ pane: string; value: ConversationMetadata | null } | null>(null);
  const [chatPrompt, setChatPrompt] = useState<{ pane: string; value: InteractivePrompt } | null>(null);
  const [promptRefresh, setPromptRefresh] = useState(0);
  const [chatSuggestion, setChatSuggestion] = useState<{ pane: string; value: string } | null>(null);
  const onChatSuggestion = useCallback((pane: string, value: string | null) => {
    setChatSuggestion((current) => value !== null
      ? (current?.pane === pane && current.value === value ? current : { pane, value })
      : current?.pane === pane ? null : current);
  }, []);
  const [pendingAnswer, setPendingAnswer] = useState<{ pane: string; promptId: string; answer: TypedAnswer } | null>(null);
  const clearPendingAnswer = useCallback(() => setPendingAnswer(null), []);
  const onChatPrompt = useCallback((pane: string, value: InteractivePrompt | null) => {
    setChatPrompt((current) => value !== null ? { pane, value } : current?.pane === pane ? null : current);
    setPendingAnswer((current) => current?.pane === pane && current.promptId !== value?.id ? null : current);
  }, []);
  useEffect(() => {
    if (agentStatus === "working") setPendingAnswer(null);
  }, [agentStatus]);
  const onChatMetadata = useCallback((pane: string, value: ConversationMetadata | null) => {
    setChatMetadata((previous) => previous?.pane === pane && previous.value?.model === value?.model
      && previous.value?.reasoning_effort === value?.reasoning_effort
      && previous.value?.context?.used === value?.context?.used
      && previous.value?.context?.window === value?.context?.window ? previous : { pane, value });
  }, []);
  const queueStore = messageQueues;
  const queueOwner = paneId === null ? null : paneStorageId(machineId, paneId);
  const queued = useSyncExternalStore(queueStore.subscribe, () => queueStore.read(queueOwner ?? ""));
  const sendingRef = useRef(false);
  const [queueSending, setQueueSending] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<{ owner: string; id: string; text: string } | null>(null);

  paneRef.current = paneId;
  onConnectionChangeRef.current = onConnectionChange;
  onServerMessageRef.current = onServerMessage;
  onRoleAckRef.current = onRoleAck;

  useEffect(() => {
    onConnectionChangeRef.current?.(connected);
  }, [connected]);

  const noteClipboard = useCallback((note: string) => {
    if (clipboardTimerRef.current !== null) window.clearTimeout(clipboardTimerRef.current);
    setClipboardNote(note);
    clipboardTimerRef.current = window.setTimeout(() => {
      clipboardTimerRef.current = null;
      setClipboardNote(null);
    }, 2500);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const linkPressed = (event: MouseEvent): boolean => event.button === 0 && !term.hasSelection();
    const term = new Terminal({
      convertEol: false,
      cursorBlink: settings.terminalCursorBlink,
      cursorStyle: settings.terminalCursorStyle,
      scrollback: 0,
      allowProposedApi: true,
      fontSize: terminalFontSize,
      fontFamily: terminalBootStack(terminalFontSize),
      theme: terminalTheme(palette, theme),
      minimumContrastRatio: TERMINAL_MIN_CONTRAST,
      linkHandler: {
        activate: (event, uri) => {
          if (!linkPressed(event)) return;
          const path = fileUriPath(uri);
          if (path !== null) openFileRef.current?.(path);
          else if (/^https?:\/\//i.test(uri)) window.open(uri, "_blank", "noopener,noreferrer");
        },
        allowNonHttpProtocols: true,
      },
      macOptionClickForcesSelection: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    matchHerdrWidths(term);
    term.loadAddon(new WebLinksAddon((_event, uri) => { window.open(uri, "_blank", "noopener,noreferrer"); }));
    term.registerLinkProvider(terminalFileLinkProvider(() => term.buffer.active, (path, event) => { if (linkPressed(event)) openFileRef.current?.(path); }));
    term.open(host);
    const compositionStart = () => setComposing(true);
    const compositionEnd = () => setComposing(false);
    host.addEventListener("compositionstart", compositionStart);
    host.addEventListener("compositionend", compositionEnd);
    term.attachCustomKeyEventHandler((event) => {
      if (isAppShortcut(event, shortcutSettings.current)) return false;
      if (!event.ctrlKey || event.altKey || event.metaKey) return true;
      const typed = event.key.toLowerCase();
      const key = /^[a-z]$/.test(typed) ? typed : /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase() ?? typed;
      if (key === "v") return false;
      if (key === "c" && term.hasSelection()) {
        if (event.type === "keydown") {
          event.preventDefault();
          copySelection();
          term.clearSelection();
        }
        return false;
      }
      return true;
    });
    term.attachCustomWheelEventHandler((event) => {
      if (drag) {
        dragWheel(event);
        return false;
      }
      if (adopted()) return false;
      if (term.hasSelection()) term.clearSelection();
      const reporting = term.modes.mouseTrackingMode !== "none";
      if (reporting && event.isTrusted && event.target && !event.ctrlKey) {
        for (let sent = 1; sent < wheelSpeedRef.current; sent += 1) {
          event.target.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true, cancelable: true, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
            clientX: event.clientX, clientY: event.clientY,
            ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
          }));
        }
      }
      return reporting;
    });
    termRef.current = term;
    fitRef.current = fit;

    const adopted = (): boolean => observeRef.current || fixedGridRef.current;
    let panned = false;
    const followCursor = (): void => {
      host.toggleAttribute("data-adopted-grid", adopted());
      const screen = term.element?.querySelector<HTMLElement>(".xterm-screen");
      if (!adopted() || panned || !screen) return;
      const row = screen.offsetHeight / term.rows;
      const cursorBottom = screen.offsetTop + (term.buffer.active.cursorY + 1) * row;
      const max = host.scrollHeight - host.clientHeight;
      host.scrollTop = cursorBottom <= host.clientHeight ? 0 : cursorBottom - row >= max ? max : cursorBottom - host.clientHeight;
    };

    let copiedText: string | null = null;
    let selectionGeneration = 0;
    let disposed = false;
    const onCopy = (event: ClipboardEvent): void => {
      if (!term.hasSelection() || copiedText === null || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", copiedText);
      event.preventDefault();
    };
    host.addEventListener("copy", onCopy);
    const copySelection = (): void => {
      const text = copiedText ?? term.getSelection();
      if (!text) return;
      if (document.execCommand("copy")) {
        noteClipboard("copied to clipboard");
        return;
      }
      if (!navigator.clipboard) {
        noteClipboard("clipboard write blocked by the browser");
        return;
      }
      void navigator.clipboard.writeText(text).then(
        () => { if (!disposed) noteClipboard("copied to clipboard"); },
        () => { if (!disposed) noteClipboard("clipboard write blocked by the browser"); },
      );
    };
    const selectionChange = term.onSelectionChange(() => {
      if (!term.hasSelection()) {
        copiedText = null;
        selectionGeneration++;
      }
    });

    interface Cell { row: number; col: number }
    interface Drag {
      pane: string;
      anchor: Cell;
      cursor: Cell;
      top: number | null;
      anchorRow: number;
      offset: number;
      maxOffset: number;
      scrolled: boolean;
      edge: -1 | 0 | 1;
      wheelPixels: number;
      sentOffset: number;
      sending: boolean;
    }
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    let drag: Drag | null = null;
    let edgeTimer: number | null = null;
    const cellAt = (event: MouseEvent): { cell: Cell; edge: -1 | 0 | 1 } => {
      const rect = (term.element?.querySelector(".xterm-screen") ?? host).getBoundingClientRect();
      const col = Math.floor((event.clientX - rect.left) / (rect.width / term.cols));
      const row = Math.floor((event.clientY - rect.top) / (rect.height / term.rows));
      return {
        cell: { row: Math.max(0, Math.min(term.rows - 1, row)), col: Math.max(0, Math.min(term.cols - 1, col)) },
        edge: row < 0 ? -1 : row >= term.rows ? 1 : 0,
      };
    };
    const ordered = (a: Cell, b: Cell): [Cell, Cell] =>
      a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a];
    const historyRange = (d: Drag): [Cell, Cell] =>
      ordered({ row: d.anchorRow, col: d.anchor.col }, { row: d.top! + d.cursor.row, col: d.cursor.col });
    const repaint = (d: Drag): void => {
      const [start, end] = historyRange(d);
      const first = d.top!;
      const last = first + term.rows - 1;
      if (end.row < first || start.row > last) {
        term.clearSelection();
        return;
      }
      const from = start.row < first ? { row: 0, col: 0 } : { row: start.row - first, col: start.col };
      const to = end.row > last ? { row: term.rows - 1, col: term.cols - 1 } : { row: end.row - first, col: end.col };
      term.select(from.col, from.row, to.row * term.cols + to.col + 1 - (from.row * term.cols + from.col));
    };
    const sendScroll = (d: Drag): void => {
      if (d.sending || d.sentOffset === d.offset) return;
      d.sending = true;
      const target = d.offset;
      void scrollPane(d.pane, target, machineId).catch(() => {}).finally(() => {
        d.sending = false;
        d.sentOffset = target;
        sendScroll(d);
      });
    };
    const scrollDrag = (d: Drag, lines: number): void => {
      if (d.top === null) return;
      const offset = Math.max(0, Math.min(d.maxOffset, d.offset + lines));
      if (offset === d.offset) return;
      d.offset = offset;
      d.top = d.maxOffset - offset;
      d.scrolled = true;
      repaint(d);
      sendScroll(d);
    };
    const dragWheel = (event: WheelEvent): void => {
      const d = drag;
      if (!d || d.top === null) return;
      const lineHeight = (term.element?.querySelector(".xterm-screen")?.getBoundingClientRect().height ?? term.rows) / term.rows;
      d.wheelPixels += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * lineHeight : event.deltaY;
      const lines = Math.trunc(d.wheelPixels / lineHeight);
      if (lines === 0) return;
      d.wheelPixels -= lines * lineHeight;
      scrollDrag(d, -lines);
    };
    const stopEdge = (): void => {
      if (edgeTimer !== null) window.clearInterval(edgeTimer);
      edgeTimer = null;
    };
    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      if ((event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents) return;
      if (!term.element?.contains(event.target as Node)) return;
      if (term.modes.mouseTrackingMode !== "none") Object.defineProperty(event, isMac ? "altKey" : "shiftKey", { value: true });
      copiedText = null;
      selectionGeneration++;
      const pane = paneRef.current;
      const { cell } = cellAt(event);
      const d: Drag = {
        pane: pane ?? "", anchor: cell, cursor: cell, top: null, anchorRow: 0, offset: 0, maxOffset: 0,
        scrolled: false, edge: 0, wheelPixels: 0, sentOffset: 0, sending: false,
      };
      drag = d;
      if (!pane || !navigator.clipboard || observeRef.current) return;
      void fetchPaneScroll(pane, machineId).then((scroll) => {
        if (!scroll || drag !== d || d.scrolled) return;
        d.offset = d.sentOffset = scroll.offset_from_bottom;
        d.maxOffset = scroll.max_offset_from_bottom;
        d.top = d.maxOffset - d.offset;
        d.anchorRow = d.top + d.anchor.row;
      }, () => {});
    };
    const onMouseMove = (event: MouseEvent): void => {
      const d = drag;
      if (!d) return;
      const { cell, edge } = cellAt(event);
      d.cursor = edge < 0 ? { row: 0, col: 0 } : edge > 0 ? { row: term.rows - 1, col: term.cols - 1 } : cell;
      if (d.top === null) return;
      if (edge !== d.edge) {
        d.edge = edge;
        stopEdge();
        if (edge !== 0) edgeTimer = window.setInterval(() => scrollDrag(d, -d.edge), 60);
      }
      if (d.scrolled || edge !== 0) {
        event.stopPropagation();
        d.scrolled = true;
        repaint(d);
      }
    };
    const onBlur = (): void => {
      stopEdge();
      drag = null;
    };
    const onMouseUp = (event: MouseEvent): void => {
      const d = drag;
      if (!d || event.button !== 0) return;
      drag = null;
      stopEdge();
      if (d.scrolled) repaint(d);
      if (!term.hasSelection()) return;
      const visibleText = term.getSelection();
      copiedText = visibleText;
      copySelection();
      const generation = selectionGeneration;
      const current = (): boolean => !disposed && paneRef.current === d.pane && generation === selectionGeneration;
      let range: [Cell, Cell] | null = null;
      if (d.scrolled) range = historyRange(d);
      else if (d.top !== null) {
        const position = term.getSelectionPosition();
        if (position) {
          const end = position.end.x > 0
            ? { row: d.top + position.end.y, col: position.end.x - 1 }
            : { row: d.top + position.end.y - 1, col: term.cols - 1 };
          range = [{ row: d.top + position.start.y, col: position.start.x }, end];
        }
      }
      if (!range) return;
      const text = fetchPaneSelection(d.pane, range[0], range[1], machineId).catch(() => {
        if (current() && d.scrolled) noteClipboard("could not read the selection from herdr");
        return visibleText;
      }).then((value) => {
        if (!current()) throw new Error("selection changed");
        copiedText = value || visibleText;
        return copiedText;
      });
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
        void blob.catch(() => {});
        void navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]).catch(() => {
          if (current() && d.scrolled) noteClipboard("copied the visible part; Copy or Ctrl+C copies the whole selection");
        });
      } else {
        void text.then(() => {
          if (current() && d.scrolled) noteClipboard("copied the visible part; Copy or Ctrl+C copies the whole selection");
        }, () => {});
      }
    };
    host.addEventListener("mousedown", onMouseDown, { capture: true });
    window.addEventListener("mousemove", onMouseMove, { capture: true });
    window.addEventListener("blur", onBlur);
    window.addEventListener("mouseup", onMouseUp);

    const osc52 = term.parser.registerOscHandler(52, (payload) => {
      const text = parseOsc52(payload);
      if (text !== null) {
        void navigator.clipboard?.writeText(text).then(
          () => noteClipboard("copied to clipboard"),
          () => noteClipboard("clipboard write blocked by the browser"),
        );
      }
      return true;
    });

    const socket = new HerdrSocket(`${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws?machine_id=${encodeURIComponent(machineId)}`);
    socketRef.current = socket;
    let outputGeneration = 0;
    const off = socket.on((message) => {
      onServerMessageRef.current?.(message);
      if (paneRef.current) setInputReady(socket.canInput(paneRef.current));
      if (message.type === "pty-data") {
        if (message.pane_id !== paneRef.current) return;
        const acknowledge = socket.outputAcknowledgement(message);
        const owner = message.pane_id;
        const generation = outputGeneration;
        term.write(message.data, () => {
          acknowledge?.();
          if (paneRef.current !== owner || generation !== outputGeneration) return;
          setOutputReady(true);
          followCursor();
          const lines: string[] = [];
          const buffer = term.buffer.active;
          for (let row = 0; row < buffer.length; row++) {
            const line = buffer.getLine(row);
            const text = line?.translateToString(!buffer.getLine(row + 1)?.isWrapped) ?? "";
            if (line?.isWrapped && lines.length) lines[lines.length - 1] += text;
            else lines.push(text);
          }
          const prompt = secretPrompt(lines.join("\n"), term.cols);
          secretRef.current = prompt;
          term.options.disableStdin = observeRef.current || prompt !== null || heldRef.current;
          setSecret((previous) => previous?.pane === owner && previous.prompt === prompt ? previous : prompt ? { pane: owner, prompt } : null);
        });
      } else if (message.type === "attach-resumed") {
        if (message.pane_id === paneRef.current) {
          setHeld(false);
          term.options.disableStdin = observeRef.current || secretRef.current !== null;
        }
      } else if (message.type === "pty-exit") {
        if (message.pane_id === paneRef.current) { setEnded(true); term.options.disableStdin = true; }
      } else if (message.type === "role-ack") {
        const nowObserving = message.mode === "observe";
        observeRef.current = nowObserving;
        setObserving(nowObserving);
        term.options.disableStdin = nowObserving || secretRef.current !== null || heldRef.current;
        onRoleAckRef.current?.(message.mode);
        if (!nowObserving && !fixedGridRef.current) {
          try {
            fit.fit();
          } catch {
          }
          const pane = paneRef.current;
          if (pane) socket.resize(pane, term.cols, term.rows, true);
        }
        panned = false;
        followCursor();
      } else if (message.type === "pane-geometry") {
        if (message.pane_id !== paneRef.current) return;
        if (message.fixed) fixedGridRef.current = true;
        if (!observeRef.current && !fixedGridRef.current) return;
        if (term.cols !== message.cols || term.rows !== message.rows) term.resize(message.cols, message.rows);
        panned = false;
        followCursor();
      } else if (message.type === "error") {
        if (message.code === "input_not_ready" || message.code === "input_failed") {
          if (message.pane_id === paneRef.current) setInputError(message.message);
          return;
        }
        if (message.code === "attach_held") {
          if (message.pane_id !== undefined && message.pane_id !== paneRef.current) return;
          setHeld(true);
          term.options.disableStdin = true;
          setConnected(socket.connected);
          return;
        }
        if (message.code === "terminal_unsupported") {
          if (message.pane_id !== undefined && message.pane_id !== paneRef.current) return;
          setUnsupported(true);
          term.options.disableStdin = true;
          setConnected(socket.connected);
          return;
        }
        if (message.code === "output_stalled" || message.code === "attach_conflict") {
          setOutputError(message.message);
          setEnded(true);
          setConnected(false);
          term.options.disableStdin = true;
          return;
        }
        term.writeln(`\r\n\u001b[31m[herdr-web-ui] ${message.code}: ${message.message}\u001b[0m`);
      }
      setConnected(socket.connected);
    });
    const offDisconnect = socket.onDisconnect(() => {
      outputGeneration++;
      setOutputReady(false);
      setInputReady(false);
      setConnected(false);
      setHeld(false);
    });
    socket.connect();

    const poll = window.setInterval(() => setConnected(socket.connected), 1000);

    let shiftEnter = false;
    const onShiftEnter = term.onKey(({ key, domEvent: event }) => {
      shiftEnter = !term.options.disableStdin && key === "\r" && event.key === "Enter" && event.shiftKey
        && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229;
    });
    const onData = term.onData((data) => {
      if (shiftEnter && data === "\r") data = "\x1b\r";
      shiftEnter = false;
      const current = paneRef.current;
      if (!current || observeRef.current || secretRef.current !== null || heldRef.current) return;
      let input = data;
      if (ctrlRef.current && isPrintable(data)) {
        ctrlRef.current = false;
        setCtrlArmed(false);
        input = controlCode(data) ?? data;
      }
      if (socket.sendInput(current, input)) return;
      if (draftPaneRef.current !== current) {
        draftPaneRef.current = current;
        setDraft(EMPTY_DRAFT);
      }
      setDraft((prev) => applyToDraft(prev, input));
    });

    let fileQueue: Promise<void> = Promise.resolve();
    const uploadFiles = (files: File[]): void => {
      const pane = paneRef.current;
      if (!pane || !socket.connected || term.options.disableStdin) return;
      fileQueue = fileQueue.then(() => uploadBatch(pane, files));
    };
    const uploadBatch = async (pane: string, files: File[]): Promise<void> => {
      if (paneRef.current !== pane || !socket.connected || term.options.disableStdin) return;
      try {
        const paths: string[] = [];
        for (const file of files) paths.push(await uploadFileRef.current(pane, file));
        if (paneRef.current !== pane || chatViewRef.current || !socket.connected || term.options.disableStdin) return;
        term.paste(paths.map((path) => `'${path.replaceAll("'", "'\\''")}'`).join(" ") + " ");
        term.focus();
      } catch (error) {
        if (paneRef.current === pane) noteClipboard(error instanceof Error ? error.message : String(error));
      }
    };
    const onFilePaste = (event: ClipboardEvent): void => {
      if (event.clipboardData?.getData("text/plain")) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      uploadFiles(files);
    };
    const onDragOver = (event: DragEvent): void => {
      if (!event.dataTransfer) return;
      if (!event.dataTransfer.types.some((type) => type === "Files" || type === "text/plain")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = term.options.disableStdin ? "none" : "copy";
    };
    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      if (!event.dataTransfer || !socket.connected || term.options.disableStdin) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) {
        uploadFiles(files);
        return;
      }
      const text = event.dataTransfer.getData("text/plain");
      if (text) {
        term.paste(text);
        term.focus();
      }
    };
    host.addEventListener("paste", onFilePaste, { capture: true });
    host.addEventListener("dragover", onDragOver);
    host.addEventListener("drop", onDrop);

    let resizeTimer: number | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        if (adopted()) {
          panned = false;
          followCursor();
          return;
        }
        try {
          fit.fit();
        } catch {
          return;
        }
        const current = paneRef.current;
        if (current) socket.resize(current, term.cols, term.rows);
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(host);

    let touchX = 0;
    let touchY = 0;
    let tracking = false;
    const onTouchStart = (event: TouchEvent): void => {
      tracking = event.touches.length === 1;
      const first = event.touches[0];
      if (tracking && first) {
        touchX = first.clientX;
        touchY = first.clientY;
      }
    };
    const onTouchMove = (event: TouchEvent): void => {
      if (!tracking || event.touches.length !== 1) return;
      event.preventDefault();
      const first = event.touches[0];
      if (!first) return;
      const delta = touchY - first.clientY;
      const across = touchX - first.clientX;
      touchX = first.clientX;
      touchY = first.clientY;
      if (adopted()) {
        panned = true;
        host.scrollBy(across, delta);
        return;
      }
      if (delta !== 0) {
        const target = term.element ?? host;
        target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: delta, clientX: first.clientX, clientY: first.clientY }));
      }
    };
    const onTouchEnd = (): void => {
      tracking = false;
    };
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd, { passive: true });

    const refit = (): void => {
      const current = paneRef.current;
      if (!current || observeRef.current || fixedGridRef.current) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      socket.resize(current, term.cols, term.rows, true);
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") refit();
    };
    window.addEventListener("focus", refit);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("mousedown", onMouseDown, { capture: true });
      window.removeEventListener("mousemove", onMouseMove, { capture: true });
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mouseup", onMouseUp);
      host.removeEventListener("copy", onCopy);
      stopEdge();
      selectionChange.dispose();
      window.removeEventListener("focus", refit);
      document.removeEventListener("visibilitychange", onVisible);
      onShiftEnter.dispose();
      onData.dispose();
      host.removeEventListener("paste", onFilePaste, { capture: true });
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("drop", onDrop);
      offDisconnect();
      osc52.dispose();
      if (clipboardTimerRef.current !== null) window.clearTimeout(clipboardTimerRef.current);
      off();
      socket.close();
      host.removeEventListener("compositionstart", compositionStart);
      host.removeEventListener("compositionend", compositionEnd);
      term.dispose();
      termRef.current = null;
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    return term ? startTerminalRenderer(term, terminalGpu) : undefined;
  }, [terminalGpu]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = terminalTheme(palette, theme);
  }, [theme, palette]);

  const { terminalCursorStyle, terminalCursorBlink } = settings;
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorStyle = terminalCursorStyle;
    term.options.cursorBlink = terminalCursorBlink;
  }, [terminalCursorStyle, terminalCursorBlink]);

  const fontFamily = terminalFontStack(terminalFontFamily);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    let superseded = false;
    const apply = (): void => {
      if (superseded || termRef.current !== term) return;
      if (term.options.fontSize === terminalFontSize && term.options.fontFamily === fontFamily) return;
      term.options.fontSize = terminalFontSize;
      term.options.fontFamily = fontFamily;
      if (observeRef.current || fixedGridRef.current) return;
      try {
        fitRef.current?.fit();
      } catch {
        return;
      }
      const pane = paneRef.current;
      if (pane) socketRef.current?.resize(pane, term.cols, term.rows, true);
    };
    void registerHostFonts(terminalFontFamily).then(() => loadFontStack(fontFamily, terminalFontSize)).then(apply);
    return () => { superseded = true; };
  }, [terminalFontSize, fontFamily, terminalFontFamily]);

  useEffect(() => {
    if (chatView || observeRef.current || fixedGridRef.current) return;
    const term = termRef.current;
    try {
      fitRef.current?.fit();
    } catch {
      return;
    }
    const pane = paneRef.current;
    if (pane && term) socketRef.current?.resize(pane, term.cols, term.rows, true);
    if (!autoSelected && !coarseRef.current) term?.focus();
  }, [chatView]);

  useLayoutEffect(() => {
    const socket = socketRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!socket || !term) return;
    setEnded(false);
    setInputReady(false);
    setInputError(null);
    setComposing(false);
    setOutputReady(false);
    setOutputError(null);
    setHeld(false);
    setUnsupported(false);
    fixedGridRef.current = false;
    hostRef.current?.toggleAttribute("data-adopted-grid", observeRef.current);
    secretRef.current = null;
    setSecret(null);
    term.options.disableStdin = observeRef.current;
    let saved = EMPTY_DRAFT;
    try {
      const value = paneId ? JSON.parse(localStorage.getItem(`herdr-web-ui:terminal-draft:${paneStorageId(machineId, paneId)}`) ?? "null") : null;
      if (value && typeof value.text === "string" && Number.isInteger(value.droppedSpecial)) saved = value;
    } catch {}
    setDraft(saved);
    draftPaneRef.current = paneId;
    term.reset();
    if (!paneId) return;
    try {
      fit?.fit();
    } catch {
    }
    socket.attach(paneId, term.cols, term.rows);
    if (!chatViewRef.current && !autoSelected && !coarseRef.current) term.focus();
    return () => {
      socket.detach(paneId);
    };
  }, [paneId]);


  const autoSelectedRef = useRef(autoSelected);
  useEffect(() => {
    const wasAuto = autoSelectedRef.current;
    autoSelectedRef.current = autoSelected;
    if (wasAuto && !autoSelected && !chatViewRef.current && !coarseRef.current) termRef.current?.focus();
  }, [autoSelected]);

  const pressKey = useCallback((key: KeyBarKey) => {
    const term = termRef.current;
    if (!term) return;
    if (composingRef.current) return;
    term.input(keySequence(key, term.modes.applicationCursorKeysMode));
    if (!inputLineRef.current) term.focus();
  }, []);

  const toggleCtrl = useCallback(() => {
    if (composingRef.current) return;
    const armed = !ctrlRef.current;
    ctrlRef.current = armed;
    setCtrlArmed(armed);
    if (!inputLineRef.current) termRef.current?.focus();
  }, []);

  const lastSentRole = useRef<ClientRole>(role);
  useEffect(() => {
    if (role === lastSentRole.current) return;
    lastSentRole.current = role;
    socketRef.current?.setMode(role);
  }, [role]);

  const sendDraft = useCallback(() => {
    const socket = socketRef.current;
    const pane = paneRef.current;
    if (!socket || !pane || draft.text.length === 0 || !socket.connected || secretRef.current !== null || heldRef.current) return;
    if (socket.sendInput(pane, draft.text)) setDraft(EMPTY_DRAFT);
  }, [draft]);

  const discardDraft = useCallback(() => {
    setDraft(EMPTY_DRAFT);
  }, []);

  const sendComposerText = useCallback((text: string): false | Promise<true | string> => {
    const term = termRef.current;
    const socket = socketRef.current;
    const pane = paneRef.current;
    if (!term || !socket || pane === null || secretRef.current !== null || heldRef.current) return false;
    const sent = socket.submit(pane, composerMessage(text), composerPayload(text, term.modes.bracketedPasteMode));
    if (sent === null) return false;
    term.scrollToBottom();
    setChatSent((current) => current + 1);
    onChatSuggestion(pane, null);
    return sent.then((result) => {
      if (!result.ok) return submitNote(result.code, result.message);
      setChatRefresh((current) => current + 1);
      return true;
    });
  }, [onChatSuggestion]);

  const sendTerminalLine = useCallback((text: string): false | Promise<true | string> => {
    const term = termRef.current;
    const socket = socketRef.current;
    const pane = paneRef.current;
    if (!term || !socket || pane === null || secretRef.current !== null) return false;
    const message = composerMessage(text);
    const payload = message.includes("\n") ? composerPayload(text, term.modes.bracketedPasteMode) : message;
    const sent = socket.submit(pane, message, payload, true);
    if (sent === null) return false;
    term.scrollToBottom();
    return sent.then((result) => (result.ok ? true : submitNote(result.code, result.message)));
  }, []);

  const pressEnter = useCallback((): boolean => {
    const socket = socketRef.current;
    const pane = paneRef.current;
    if (!socket || pane === null || !socket.connected) return false;
    const sent = socket.sendInput(pane, "\r");
    termRef.current?.scrollToBottom();
    return sent;
  }, []);

  const toggleDirect = useCallback(() => {
    if (composingRef.current) return;
    updateSettings({ terminalInputMode: directTyping ? "line" : "direct" });
  }, [directTyping, updateSettings]);

  const directTypingRef = useRef(directTyping);
  useEffect(() => {
    const turnedOn = directTyping && !directTypingRef.current;
    directTypingRef.current = directTyping;
    const textarea = hostRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea");
    if (!textarea) return;
    if (inputLine) {
      textarea.setAttribute("inputmode", "none");
      if (document.activeElement === textarea) textarea.blur();
    } else {
      textarea.removeAttribute("inputmode");
      if (coarse && !chatView && turnedOn) termRef.current?.focus();
    }
  }, [inputLine, coarse, chatView, directTyping, paneId]);

  const abortTurn = useCallback(() => {
    const term = termRef.current;
    const socket = socketRef.current;
    if (!term || !socket || !socket.connected) return;
    term.input("\u001b");
  }, []);

  const answering = chatView && chatPrompt !== null && chatPrompt.pane === paneId && !chatPrompt.value.queued && !chatPrompt.value.fallback ? chatPrompt.value : null;
  const heldByOpenQueue = chatView && chatPrompt !== null && chatPrompt.pane === paneId && chatPrompt.value.queued === "open";
  const busy = agent !== null && agentStatus === "working" && answering === null;
  const readyForQueue = agentStatus !== undefined && QUEUE_READY_STATUS[agentStatus] === true;

  const composerSend = useCallback(
    (text: string): boolean | string | Promise<boolean | string> => {
      const pane = paneRef.current;
      if (pane !== null && heldByOpenQueue) {
        return t("Codex has a question open in the terminal: answer it above, or close it there (alt+↓) to message Codex.");
      }
      if (pane !== null && answering !== null) {
        const choice = answerFromText(answering, text);
        if (choice === null) return answerRefusal(answering);
        if (needsConfirmation(answering, choice)) {
          setPendingAnswer({ pane, promptId: answering.id, answer: choice });
          return true;
        }
        setPendingAnswer(null);
        return answerPanePrompt({ pane_id: pane, prompt_id: answering.id, ...choice }).then(
          () => { setPromptRefresh((key) => key + 1); return true; },
          (cause: unknown) => {
            setPromptRefresh((key) => key + 1);
            return cause instanceof ApiError && cause.status === 409 ? t("The question on screen changed; check it and answer again.") : String(cause instanceof Error ? cause.message : cause);
          },
        );
      }
      if (pane !== null && agent !== null && agentStatus === "working") {
        queueStore.add(paneStorageId(machineId, pane), text);
        return true;
      }
      return sendComposerText(text);
    },
    [agent, agentStatus, answerPanePrompt, answering, heldByOpenQueue, sendComposerText, queueStore, machineId],
  );


  const uploadImage = useCallback((file: File) => uploadPaneImage(paneId ?? "", file), [paneId]);

  return (
    <div className={`terminal-stack${chatView ? " is-chat" : ""}`} data-direct-typing={coarse && directTyping && !chatView ? "" : undefined}>
      {paneId === null && restoreError !== null && (
        <div className="terminal-placeholder is-restore-error" role="status">
          <div className="terminal-placeholder-inner">
            <TriangleAlert aria-hidden="true" />
            <span>{t("herdr could not restore this pane")}</span>
            <span className="terminal-placeholder-detail">{restoreError}</span>
          </div>
        </div>
      )}
      {paneId === null && restoreError === null && (
        <div className="terminal-placeholder">
          <div className="terminal-placeholder-inner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
              <path d="M7 9l3 3-3 3" />
              <path d="M12.5 15h4.5" />
            </svg>
            <span>{t("Select a pane to open its terminal")}</span>
          </div>
        </div>
      )}
      <div className="terminal-banners">
        {paneId !== null && held && (
          <div className="terminal-banner terminal-banner-warning" role="status">
            <span>{t("Another app has this pane open. It connects here as soon as that app lets go.")}</span>
          </div>
        )}
        {paneId !== null && !chatView && unsupported && (
          <div className="terminal-banner terminal-banner-soon" role="status">
            <span>{t("Live terminal is coming to Windows PCs: herdr cannot attach a terminal there yet. The chat lens works now.")}</span>
          </div>
        )}
        {paneId !== null && outputError && (
          <div className="terminal-banner terminal-banner-warning terminal-banner-output-error" role="status">
            <span>{outputError}</span>
            <a className="btn" href={`?machine=${encodeURIComponent(machineId)}&pane=${encodeURIComponent(paneId)}`}>{t("Reconnect")}</a>
          </div>
        )}
        {!chatView && inputError && <div className="terminal-banner" role="status">{inputError}<button className="btn" onClick={() => setInputError(null)}>{t("Dismiss")}</button></div>}
        {!chatView && !observing && connected && !inputReady && !held && !ended && <div className="terminal-banner" role="status">{t("Waiting for terminal input…")}</div>}
        {paneId !== null && !chatView && ended && !outputError && (
          <div className="terminal-banner" role="status">
            terminal ended{!draftIsEmpty(draft) ? " — held input discarded" : ""}
          </div>
        )}
        {paneId !== null && !chatView && !ended && !connected && (
          <div className="terminal-banner terminal-banner-warning" role="status">
            reconnecting to herdr web ui…
            {!draftIsEmpty(draft) && <span className="draft-held"> input held: “{draft.text}”</span>}
          </div>
        )}
        {paneId !== null && !ended && connected && !draftIsEmpty(draft) && (
          <div className="terminal-banner terminal-banner-draft" role="status">
            <span className="draft-label">{t("Input held until the terminal is ready:")}</span>
            <code className="draft-text">{draft.text.length > 0 ? draft.text : "—"}</code>
            {draft.droppedSpecial > 0 && (
              <span className="draft-dropped">{t(draft.droppedSpecial === 1 ? "{count} special key dropped" : "{count} special keys dropped", { count: draft.droppedSpecial })}</span>
            )}
            <span className="draft-actions">
              <button type="button" className="draft-send" disabled={draft.text.length === 0 || observing || secretActive || held} onClick={sendDraft}>
                {t("Send")}
              </button>
              <button type="button" className="draft-discard" onClick={discardDraft}>
                {t("Discard")}
              </button>
            </span>
          </div>
        )}
        {paneId !== null && !ended && observing && (
          <div className="terminal-banner terminal-banner-observe" role="status">
            view only — the operator’s screen size is untouched
          </div>
        )}
        {clipboardNote && (
          <div className="terminal-banner" role="status">
            {clipboardNote}
          </div>
        )}
      </div>
      <div className="terminal-surface">
        <div className={`pane-terminal${paneId === null ? " is-idle" : ""}`} ref={hostRef} />
        {paneId !== null && chatView && (
          <RenderBoundary resetKey={paneId} fallback={(retry) => (
            <div className="chat-view absolute inset-0 z-1 overflow-y-auto bg-background px-4 pt-6 pb-5"><div className={CHAT_EMPTY} role="alert">
              <p className="m-0 text-ui">{t("The chat can't be shown. The terminal still works.")}</p>
              <Button variant="outline" size="sm" onClick={retry}>{t("Try again")}</Button>
            </div></div>
          )}>
          <ChatView
            paneId={paneId}
            refreshKey={chatRefresh}
            sentKey={chatSent}
            connected={connected}
            ended={ended}
            agent={agent}
            agentStatus={agentStatus}
            onMetadata={onChatMetadata}
            onPrompt={onChatPrompt}
            onSuggestion={onChatSuggestion}
            promptRefreshKey={promptRefresh}
            pendingAnswer={pendingAnswer !== null && pendingAnswer.pane === paneId ? pendingAnswer : null}
            onPendingAnswerDone={clearPendingAnswer}
          />
          </RenderBoundary>
        )}
      </div>
      {paneId !== null && chatView && !observing && !ended && queueOwner !== null && queued.length > 0 && (
        <section className="composer-queue" aria-label={t("Queued messages")}>
          <div className="composer-queue-heading">
            <strong>{t("Queued messages ({n})", { n: queued.length })}</strong>
            <span className="composer-queue-label">{t(readyForQueue ? "Held message — review and send" : "Held until the agent is ready")}</span>
          </div>
          {queueStore.isUnsaved(queueOwner) && <p className="composer-queue-error" role="status">{t("Queue could not be saved. Keep this tab open or copy the messages before reloading.")}</p>}
          <ol className="composer-queue-list">
          {queued.map((message, index) => <li className="composer-queue-item" key={message.id}>
            <label className="composer-queue-label" htmlFor={`queued-${message.id}`}>{t("Message {n}", { n: index + 1 })}</label>
            <textarea
              id={`queued-${message.id}`}
              className="composer-queue-text"
              value={message.text}
              rows={Math.min(4, message.text.split("\n").length)}
              aria-label={t("Queued message {n}", { n: index + 1 })}
              maxLength={MAX_COMPOSER_CHARS}
              disabled={queueStore.isSending(message.id)}
              spellCheck={false} autoCapitalize="off" autoCorrect="off"
              onChange={(event) => { queueStore.edit(queueOwner, message.id, event.target.value); }}
            />
            <div className="composer-queue-actions">
              <button type="button" className="composer-queue-send"
                disabled={!connected || held || secretActive || queueSending !== null || queued.some((item) => queueStore.isSending(item.id)) || heldByOpenQueue || message.text.trim().length === 0}
                title={heldByOpenQueue ? t("Codex has a question open in the terminal: answer it above first") : undefined}
                onClick={() => {
                  if (sendingRef.current || !queueStore.beginSend(queueOwner, message.id)) return;
                  sendingRef.current = true;
                  setQueueSending(message.id); setQueueError(null);
                  const owner = queueOwner;
                  void Promise.resolve(sendComposerText(message.text))
                    .then((result) => {
                      if (result === true) { queueStore.remove(owner, message.id); }
                      else setQueueError({ owner, id: message.id, text: typeof result === "string" ? result : t("Not sent. Reconnect and try again.") });
                    })
                    .catch(() => setQueueError({ owner, id: message.id, text: t("Not confirmed. Check the terminal before sending again.") }))
                    .finally(() => { queueStore.endSend(owner, message.id); sendingRef.current = false; setQueueSending(null); });
                }}>{t("Send now")}</button>
              <button type="button" className="composer-queue-discard" disabled={queueStore.isSending(message.id)}
                onClick={() => { queueStore.remove(queueOwner, message.id); }}>{t("Discard")}</button>
            </div>
            {queueError?.owner === queueOwner && queueError.id === message.id && <p className="composer-queue-error" role="status">{queueError.text}</p>}
          </li>)}
          </ol>
        </section>
      )}
      {paneId !== null && secretActive && !observing && !ended && connected && outputReady && <SecretInput
        key={`${paneId}:${secret.prompt}`} prompt={secret.prompt}
        onSend={(value) => socketRef.current?.sendSecret(paneId, secret.prompt, value) ?? null}
        onCancel={() => { if (socketRef.current?.connected) socketRef.current.sendInput(paneId, "\u0003"); }}
      />}
      {paneId !== null && chatView && !secretActive && !observing && !ended && (
        <Composer
          key={paneId}
          paneId={paneId}
          autoFocus={!autoSelected && !coarse}
          agent={agent}
          agentStatus={agentStatus}
          backgroundTasks={backgroundTasks}
          metadata={chatMetadata?.pane === paneId ? chatMetadata.value : null}
          connected={connected && !held}
          queueMode={busy}
          answerHint={answering === null ? null
            : pendingAnswer?.promptId === answering.id ? t("Confirm your answer in the card above, or type another…") : answerHint(answering)}
          suggestion={chatPrompt?.pane !== paneId && chatSuggestion?.pane === paneId ? chatSuggestion.value : null}
          onSend={composerSend}
          onCommand={sendTerminalLine}
          onAbort={abortTurn}
          onUploadImage={uploadImage}
        />
      )}
      {paneId !== null && !secretActive && !observing && !ended && inputLine && <TerminalInput key={paneId} owner={paneStorageId(machineId, paneId)} onComposing={setComposing} connected={connected && !held} onSend={sendTerminalLine} onEnter={pressEnter} />}
      {paneId !== null && !secretActive && !observing && !chatView && <KeyBar disabled={composing} onKey={pressKey} ctrlArmed={ctrlArmed} onToggleCtrl={toggleCtrl}
        directTyping={directTyping} onToggleDirect={toggleDirect} />}
    </div>
  );
}
