import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { hasDictionary, LANGUAGE_SETTINGS, loadDictionary, LOCALE_TAGS, resolveLanguage, setCurrentLanguage, type Language, type LanguageSetting } from "./i18n.ts";
import type { AlertPrefs, DoneAlerts } from "../../shared/notify-policy.ts";
import { chatFontStack, sanitizeFontFamily } from "./fontFamily.ts";
import { coerceTheme, DEFAULT_THEME, modeFor, themeColor, type ThemeName } from "./theme.ts";

export type ThemeSetting = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type Density = "compact" | "comfortable";
export type SidebarGrouping = "workspace" | "directory";
export type UsageCount = "used" | "left";
export type Palette = ThemeName;
export type UsagePlacement = "footer" | "top";
export type DefaultView = "auto" | "chat" | "terminal";
export type TerminalCursor = "block" | "bar" | "underline";

export const TERMINAL_CURSORS: readonly TerminalCursor[] = ["block", "bar", "underline"];

import { sanitizeShortcutOverrides, type ShortcutOverrides } from "./shortcutBindings.ts";

export interface Settings {
  terminalInputMode: "auto" | "line" | "direct";
  shortcutOverrides: ShortcutOverrides;
  theme: ThemeSetting;
  density: Density;
  sidebarGrouping: SidebarGrouping;
  palette: Palette;
  terminalFontSize: number;
  terminalWheelSpeed: number;
  terminalFontFamily: string;
  terminalGpu: boolean;
  terminalCursorStyle: TerminalCursor;
  terminalCursorBlink: boolean;
  uiFontSize: number | null;
  chatFontSize: number | null;
  chatFontFamily: string;
  enterSends: boolean;
  showThinking: boolean;
  keepScreenOn: boolean;
  language: LanguageSetting;
  alertsOn: boolean;
  alertInput: boolean;
  alertDone: DoneAlerts;
  alertInApp: boolean;
  quickReplies: string[];
  showQuickReplies: boolean;
  showSuggestionChip: boolean;
  showUsage: boolean;
  usageCount: UsageCount;
  usagePlacement: UsagePlacement;
  defaultView: DefaultView;
  usageOrder: string[];
  usageHidden: string[];
  voiceInput: boolean;
  voicePolishChat: boolean;
  voicePolishTerminal: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  terminalInputMode: "auto",
  shortcutOverrides: {},
  theme: "dark",
  density: "comfortable",
  sidebarGrouping: "workspace",
  palette: DEFAULT_THEME,
  terminalFontSize: 13,
  terminalWheelSpeed: 1,
  terminalFontFamily: "",
  terminalGpu: true,
  terminalCursorStyle: "block",
  terminalCursorBlink: true,
  uiFontSize: null,
  chatFontSize: null,
  chatFontFamily: "",
  enterSends: true,
  showThinking: false,
  keepScreenOn: false,
  language: "system",
  alertsOn: true,
  alertInput: true,
  alertDone: "long",
  alertInApp: true,
  quickReplies: ["continue", "yes", "no", "commit and push", "retry"],
  showQuickReplies: false,
  showSuggestionChip: false,
  showUsage: false,
  usageCount: "used",
  usagePlacement: "footer",
  defaultView: "auto",
  usageOrder: [],
  usageHidden: [],
  voiceInput: false,
  voicePolishChat: true,
  voicePolishTerminal: false,
};

export const QUICK_REPLIES_MAX = 12;
export const USAGE_KEYS_MAX = 64;

function usageKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is string => typeof key === "string" && key.length > 0 && key.length <= 512))].slice(0, USAGE_KEYS_MAX);
}
export const QUICK_REPLY_MAX_CHARS = 200;

export function quickReplyButtons(settings: Settings): string[] {
  return settings.quickReplies.filter((reply) => reply.trim() !== "");
}

export function alertPrefs(settings: Settings): AlertPrefs {
  return { input: settings.alertInput, done: settings.alertDone };
}

const STORAGE_KEY = "herdr-web-ui:settings";
export const TERMINAL_FONT_MIN = 10;
export const TERMINAL_FONT_MAX = 22;
export const TERMINAL_WHEEL_SPEED_MIN = 1;
export const TERMINAL_WHEEL_SPEED_MAX = 10;

export const CHAT_FONT_MIN = 11;
export const CHAT_FONT_MAX = 24;
const CHAT_BASE_FONT: Record<Density, number> = { comfortable: 14, compact: 13 };

export const UI_FONT_MIN = 11;
export const UI_FONT_MAX = 16;
const UI_BASE_FONT = 13;

function clampedOrNull(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : null;
}

function clampFont(size: number): number {
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(size)));
}

export function uiFontSize(settings: Settings): number {
  return settings.uiFontSize ?? UI_BASE_FONT;
}

export function chatFontSize(settings: Settings): number {
  return settings.chatFontSize ?? CHAT_BASE_FONT[settings.density];
}

export function sanitizeSettings(raw: unknown): Settings {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const theme = record["theme"];
  const density = record["density"];
  const font = record["terminalFontSize"];
  return {
    terminalInputMode: record["terminalInputMode"] === "line" || record["terminalInputMode"] === "direct" ? record["terminalInputMode"] : "auto",
    shortcutOverrides: sanitizeShortcutOverrides(record["shortcutOverrides"]),
    theme: theme === "dark" || theme === "light" || theme === "system" ? theme : DEFAULT_SETTINGS.theme,
    density: density === "compact" || density === "comfortable" ? density : DEFAULT_SETTINGS.density,
    sidebarGrouping: record["sidebarGrouping"] === "workspace" || record["sidebarGrouping"] === "directory" ? record["sidebarGrouping"] : DEFAULT_SETTINGS.sidebarGrouping,
    palette: coerceTheme(record["palette"]),
    terminalFontSize: typeof font === "number" && Number.isFinite(font) ? clampFont(font) : DEFAULT_SETTINGS.terminalFontSize,
    terminalWheelSpeed: typeof record["terminalWheelSpeed"] === "number" && Number.isFinite(record["terminalWheelSpeed"])
      ? Math.min(TERMINAL_WHEEL_SPEED_MAX, Math.max(TERMINAL_WHEEL_SPEED_MIN, Math.round(record["terminalWheelSpeed"])))
      : DEFAULT_SETTINGS.terminalWheelSpeed,
    chatFontSize: clampedOrNull(record["chatFontSize"], CHAT_FONT_MIN, CHAT_FONT_MAX),
    uiFontSize: clampedOrNull(record["uiFontSize"], UI_FONT_MIN, UI_FONT_MAX),
    terminalFontFamily: sanitizeFontFamily(record["terminalFontFamily"]),
    terminalGpu: typeof record["terminalGpu"] === "boolean" ? record["terminalGpu"] : DEFAULT_SETTINGS.terminalGpu,
    terminalCursorStyle: TERMINAL_CURSORS.includes(record["terminalCursorStyle"] as TerminalCursor) ? record["terminalCursorStyle"] as TerminalCursor : DEFAULT_SETTINGS.terminalCursorStyle,
    terminalCursorBlink: typeof record["terminalCursorBlink"] === "boolean" ? record["terminalCursorBlink"] : DEFAULT_SETTINGS.terminalCursorBlink,
    chatFontFamily: sanitizeFontFamily(record["chatFontFamily"]),
    enterSends: typeof record["enterSends"] === "boolean" ? record["enterSends"] : DEFAULT_SETTINGS.enterSends,
    showThinking: typeof record["showThinking"] === "boolean" ? record["showThinking"] : DEFAULT_SETTINGS.showThinking,
    keepScreenOn: typeof record["keepScreenOn"] === "boolean" ? record["keepScreenOn"] : DEFAULT_SETTINGS.keepScreenOn,
    language: LANGUAGE_SETTINGS.includes(record["language"] as LanguageSetting) ? record["language"] as LanguageSetting : DEFAULT_SETTINGS.language,
    alertsOn: typeof record["alertsOn"] === "boolean" ? record["alertsOn"] : DEFAULT_SETTINGS.alertsOn,
    alertInput: typeof record["alertInput"] === "boolean" ? record["alertInput"] : DEFAULT_SETTINGS.alertInput,
    alertDone: record["alertDone"] === "off" || record["alertDone"] === "long" || record["alertDone"] === "always" ? record["alertDone"] : DEFAULT_SETTINGS.alertDone,
    alertInApp: typeof record["alertInApp"] === "boolean" ? record["alertInApp"] : DEFAULT_SETTINGS.alertInApp,
    quickReplies: Array.isArray(record["quickReplies"])
      ? record["quickReplies"].filter((reply): reply is string => typeof reply === "string").slice(0, QUICK_REPLIES_MAX).map((reply) => reply.slice(0, QUICK_REPLY_MAX_CHARS))
      : [...DEFAULT_SETTINGS.quickReplies],
    showQuickReplies: typeof record["showQuickReplies"] === "boolean" ? record["showQuickReplies"] : DEFAULT_SETTINGS.showQuickReplies,
    showSuggestionChip: typeof record["showSuggestionChip"] === "boolean" ? record["showSuggestionChip"] : DEFAULT_SETTINGS.showSuggestionChip,
    showUsage: typeof record["showUsage"] === "boolean" ? record["showUsage"] : DEFAULT_SETTINGS.showUsage,
    usageCount: record["usageCount"] === "used" || record["usageCount"] === "left" ? record["usageCount"] : DEFAULT_SETTINGS.usageCount,
    usagePlacement: record["usagePlacement"] === "top" || record["usagePlacement"] === "footer" ? record["usagePlacement"] : DEFAULT_SETTINGS.usagePlacement,
    defaultView: record["defaultView"] === "chat" || record["defaultView"] === "terminal" || record["defaultView"] === "auto" ? record["defaultView"] : DEFAULT_SETTINGS.defaultView,
    usageOrder: usageKeys(record["usageOrder"]),
    usageHidden: usageKeys(record["usageHidden"]),
    voiceInput: typeof record["voiceInput"] === "boolean" ? record["voiceInput"] : DEFAULT_SETTINGS.voiceInput,
    voicePolishChat: typeof record["voicePolishChat"] === "boolean" ? record["voicePolishChat"] : DEFAULT_SETTINGS.voicePolishChat,
    voicePolishTerminal: typeof record["voicePolishTerminal"] === "boolean" ? record["voicePolishTerminal"] : DEFAULT_SETTINGS.voicePolishTerminal,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_SETTINGS : sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    return;
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(setting: ThemeSetting): ResolvedTheme {
  if (setting !== "system") return setting;
  return typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches === false ? "light" : "dark";
}

function applyToDocument(settings: Settings, resolved: ResolvedTheme, language: Language): void {
  const root = document.documentElement;
  root.lang = LOCALE_TAGS[language];
  root.dataset["theme"] = settings.palette;
  root.dataset["mode"] = resolved;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset["density"] = settings.density;
  root.style.setProperty("--chat-scale", String(chatFontSize(settings) / CHAT_BASE_FONT[settings.density]));
  if (settings.uiFontSize === null) root.style.removeProperty("--fs-ui");
  else root.style.setProperty("--fs-ui", `${settings.uiFontSize}px`);
  const chatFont = chatFontStack(settings.chatFontFamily);
  if (chatFont === null) root.style.removeProperty("--font-chat");
  else root.style.setProperty("--font-chat", chatFont);
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor(settings.palette, resolved));
}

interface SettingsContextValue {
  settings: Settings;
  resolvedTheme: ResolvedTheme;
  resolvedLanguage: Language;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function useLoadedLanguage(wanted: Language): Language {
  const [loaded, setLoaded] = useState<Language>(() => (hasDictionary(wanted) ? wanted : "en"));
  useEffect(() => {
    let live = true;
    void loadDictionary(wanted).then(() => { if (live) setLoaded(wanted); }, () => undefined);
    return () => { live = false; };
  }, [wanted]);
  return loaded;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [systemDark, setSystemDark] = useState(() => resolveTheme("system") === "dark");

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = modeFor(settings.palette, settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme);

  const [browserLanguages, setBrowserLanguages] = useState<readonly string[]>(() => (typeof navigator !== "undefined" ? navigator.languages : []));
  useEffect(() => {
    const onChange = (): void => setBrowserLanguages([...navigator.languages]);
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, []);
  const resolvedLanguage = useLoadedLanguage(resolveLanguage(settings.language, browserLanguages));
  setCurrentLanguage(resolvedLanguage);

  useEffect(() => {
    applyToDocument(settings, resolvedTheme, resolvedLanguage);
  }, [settings, resolvedTheme, resolvedLanguage]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = sanitizeSettings({ ...current, ...patch });
      saveSettings(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, resolvedTheme, resolvedLanguage, update }), [settings, resolvedTheme, resolvedLanguage, update]);
  return createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (value === null) throw new Error("useSettings needs a SettingsProvider above it");
  return value;
}

export const PANE_VIEW_KEY_PREFIX = "herdr-web-ui:view:";

export function forgetPaneViews(given?: Pick<Storage, "length" | "key" | "removeItem">): number {
  const keys: string[] = [];
  try {
    const storage = given ?? window.localStorage;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PANE_VIEW_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    return keys.length;
  }
  return keys.length;
}
