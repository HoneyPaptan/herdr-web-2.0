import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Minus, Plus, Star, X } from "lucide-react";

import "./SettingsDialog.css";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AppActions } from "../lib/actions.ts";
import { useInstallPrompt } from "../lib/install.ts";
import { SHORTCUTS, formatKeys, shortcutKeys, shortcutConflict } from "../lib/shortcuts.ts";
import { CHAT_FONT_MAX, CHAT_FONT_MIN, chatFontSize, DEFAULT_SETTINGS, type TerminalCursor, type ThemeSetting, UI_FONT_MAX, UI_FONT_MIN, uiFontSize, QUICK_REPLIES_MAX, QUICK_REPLY_MAX_CHARS, TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, TERMINAL_WHEEL_SPEED_MAX, TERMINAL_WHEEL_SPEED_MIN, useSettings, forgetPaneViews, type Settings } from "../lib/settings.ts";
import { hasLightMode, THEMES } from "../lib/theme.ts";
import { ChoicePills, ThemeSwatches, type Choice } from "./SettingsChoices.tsx";
import { InlineRow, SETTINGS_INPUT, SETTINGS_SELECT, SettingDescription, SettingNote, SettingsSection, SettingsTabs, StackedRow, type SettingsTab } from "./SettingsLayout.tsx";
import { LANGUAGE_NAMES, LANGUAGE_SETTINGS, useT } from "../lib/i18n.ts";
import { FONT_FAMILY_MAX_CHARS, sanitizeFontFamily } from "../lib/fontFamily.ts";
import { hostFonts } from "../lib/hostFonts.ts";
import type { UpdatesModel } from "../lib/updates.ts";
import type { MachineSettings } from "../../shared/machines.ts";
import { fetchRemoteAccess, fetchVoiceStatus, machineRequest, saveVoiceConfig } from "../lib/api.ts";
import { isLoopbackHost, phonePlan } from "../lib/phone.ts";
import type { HealthAuth, HostFontFamily, ProviderUsage, RemoteAccess } from "../../shared/protocol.ts";
import type { VoiceStatus } from "../../shared/voice.ts";
import { VOICE_CONFIG_EVENT } from "../lib/voice.ts";
import { moveInOrder, orderProviders, PROVIDER_MARK, PROVIDER_NAME, usageName, useUsage } from "../lib/usage.ts";
import { AgentMark } from "./AgentMark.tsx";
import { DevicesPanel } from "./DevicesPanel.tsx";
import { PhonePanel } from "./PhonePanel.tsx";
import { PushTestControls } from "./PushTestControls.tsx";
import { UpdateControls } from "./UpdateControls.tsx";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  actions: AppActions;
  updates: UpdatesModel;
  auth: HealthAuth | null;
  onEnableNotifications: () => Promise<boolean>;
}

type TabId = "appearance" | "terminal" | "chat" | "voice" | "alerts" | "usage" | "shortcuts" | "phone" | "about";

const FIRST_TAB: TabId = "appearance";
const FONT_FAMILY_PLACEHOLDER = 'D2Coding, "Cascadia Mono"';
const ROW_ACTION = "text-muted-foreground hover:text-foreground";
const SHORTCUT_KEYS = [..."abcdefghijklmnopqrstuvwxyz0123456789,", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

function SettingSwitch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <Switch className="settings-toggle" checked={checked} aria-label={label} onCheckedChange={onChange} />;
}

function Stepper({ label, value, min, max, unit, decreaseLabel, increaseLabel, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  decreaseLabel: string;
  increaseLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-stepper flex h-7 items-center gap-0.5 rounded-lg border border-input px-0.5 dark:bg-input/30" role="group" aria-label={label}>
      <Button variant="ghost" size="icon-xs" className={ROW_ACTION} aria-label={decreaseLabel} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus /></Button>
      <output aria-live="polite" className="min-w-[4ch] text-center text-ui tabular-nums">{value}{unit}</output>
      <Button variant="ghost" size="icon-xs" className={ROW_ACTION} aria-label={increaseLabel} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus /></Button>
    </div>
  );
}

function compactKeys(keys: readonly string[]): string {
  return formatKeys(keys).map((key) => ({ Shift: "⇧", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }[key] ?? (key.length === 1 ? key.toUpperCase() : key))).join("+");
}

function isImeEnter(event: React.KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

function useHostFamilies(monoOnly: boolean): string[] {
  const [families, setFamilies] = useState<HostFontFamily[]>([]);
  useEffect(() => {
    let live = true;
    void hostFonts().then((report) => { if (live) setFamilies(report.families); });
    return () => { live = false; };
  }, []);
  return families.filter((family) => !monoOnly || family.mono).map((family) => family.family);
}

function FontFamilyInput({ value, label, monoOnly = false, onCommit }: { value: string; label: string; monoOnly?: boolean; onCommit: (family: string) => void }) {
  const listId = useId();
  const families = useHostFamilies(monoOnly);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    const next = sanitizeFontFamily(draft);
    setDraft(next);
    if (next !== value) onCommit(next);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);
  return (
    <>
      <input
        className={cn("settings-font-input", SETTINGS_INPUT)}
        list={families.length > 0 ? listId : undefined}
        value={draft}
        placeholder={FONT_FAMILY_PLACEHOLDER}
        maxLength={FONT_FAMILY_MAX_CHARS}
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || isImeEnter(event)) return;
          event.preventDefault();
          commit();
        }}
      />
      {families.length > 0 && (
        <datalist id={listId}>
          {families.map((family) => <option key={family} value={family} />)}
        </datalist>
      )}
    </>
  );
}

function UsageAccounts({ providers }: { providers: readonly ProviderUsage[] }) {
  const { settings, update } = useSettings();
  const t = useT();
  const ordered = orderProviders(providers, settings.usageOrder);
  const keys = ordered.map((usage) => usage.key);
  const move = (key: string, by: -1 | 1) => update({ usageOrder: moveInOrder(keys, settings.usageOrder, key, by) });
  const toggle = (key: string, hidden: boolean) => update({ usageHidden: hidden ? settings.usageHidden.filter((other) => other !== key) : [...settings.usageHidden, key] });
  return (
    <StackedRow label={t("Accounts")}>
      <ol className="usage-accounts flex flex-col" aria-label={t("Accounts")}>
        {ordered.map((usage, index) => {
          const name = usageName(usage);
          const hidden = settings.usageHidden.includes(usage.key);
          return (
            <li key={usage.key} className={cn("usage-accounts-row flex h-7 min-w-0 items-center gap-3", hidden && "is-hidden")}>
              <span className={cn("flex min-w-0 flex-1 items-center gap-2", hidden && "opacity-50")}>
                <AgentMark agent={PROVIDER_MARK[usage.id]} size={16} className="size-4 shrink-0" />
                <span className="shrink-0 text-ui">{PROVIDER_NAME[usage.id]}</span>
                <span className="min-w-0 truncate text-ui text-muted-foreground/60" title={usage.account ?? undefined}>{usage.account}</span>
              </span>
              <span className="flex shrink-0 items-center gap-0.5">
                <Button variant="ghost" size="icon-xs" className={ROW_ACTION} aria-label={t("Move {name} up", { name })} disabled={index === 0} onClick={() => move(usage.key, -1)}><ChevronUp aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon-xs" className={ROW_ACTION} aria-label={t("Move {name} down", { name })} disabled={index === ordered.length - 1} onClick={() => move(usage.key, 1)}><ChevronDown aria-hidden="true" /></Button>
                <Button variant="ghost" size="icon-xs" className={cn("usage-accounts-visibility", ROW_ACTION)} role="switch" aria-checked={!hidden} aria-label={t("Show {name}", { name })} onClick={() => toggle(usage.key, hidden)}>
                  {hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      {settings.usageOrder.length > 0 && (
        <Button variant="ghost" size="sm" className="usage-accounts-reset w-fit text-ui text-muted-foreground" onClick={() => update({ usageOrder: [] })}>{t("Nearest limit first")}</Button>
      )}
    </StackedRow>
  );
}

function shortcutValue(settings: Settings, id: string): string {
  if (!Object.hasOwn(settings.shortcutOverrides, id)) return "default";
  return settings.shortcutOverrides[id] ?? "off";
}

function ShortcutRow({ shortcut }: { shortcut: (typeof SHORTCUTS)[number] }) {
  const { settings, update } = useSettings();
  const t = useT();
  const label = t(shortcut.label);
  const assign = (value: string): void => {
    const next = { ...settings.shortcutOverrides };
    if (value === "default") delete next[shortcut.id];
    else next[shortcut.id] = value === "off" ? null : value;
    update({ shortcutOverrides: next });
  };
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="min-w-0 flex-1 truncate text-ui">{label}</span>
      {shortcut.id === "voice" ? (
        <KbdGroup>{formatKeys(shortcut.keys).map((key) => <Kbd key={key}>{key}</Kbd>)}</KbdGroup>
      ) : (
        <select className={SETTINGS_SELECT} aria-label={label} value={shortcutValue(settings, shortcut.id)} onChange={(event) => assign(event.target.value)}>
          <option value="default" title={t("Default")} disabled={shortcutConflict(shortcut.id, shortcutKeys(shortcut.id, {}), settings.shortcutOverrides)}>{compactKeys(shortcut.keys)}</option>
          <option value="off" title={t("Send keys to terminal")}>{t("Off")}</option>
          {SHORTCUT_KEYS.map((key) => {
            const conflict = shortcutConflict(shortcut.id, [key], settings.shortcutOverrides);
            return <option key={key} value={key} disabled={conflict}>{compactKeys(["Mod", "Shift", key])}{conflict ? ` (${t("Already assigned")})` : ""}</option>;
          })}
        </select>
      )}
    </div>
  );
}

function QuickReplies() {
  const { settings, update } = useSettings();
  const t = useT();
  const replies = settings.quickReplies;
  return (
    <>
      <ol className="quick-replies-list flex flex-col gap-1.5">
        {replies.map((reply, index) => (
          <li key={index} className="flex items-center gap-1.5">
            <input
              className={SETTINGS_INPUT}
              value={reply}
              maxLength={QUICK_REPLY_MAX_CHARS}
              aria-label={t("Quick reply {number}", { number: index + 1 })}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => update({ quickReplies: replies.map((current, at) => at === index ? event.target.value : current) })}
            />
            <Button variant="ghost" size="icon-sm" className={ROW_ACTION} aria-label={t("Remove quick reply {number}", { number: index + 1 })} onClick={() => update({ quickReplies: replies.filter((_, at) => at !== index) })}>
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="text-ui" disabled={replies.length >= QUICK_REPLIES_MAX} onClick={() => update({ quickReplies: [...replies, ""] })}><Plus aria-hidden="true" />{t("Add reply")}</Button>
        <Button variant="ghost" size="sm" className="text-ui text-muted-foreground" onClick={() => update({ quickReplies: [...DEFAULT_SETTINGS.quickReplies] })}>{t("Restore defaults")}</Button>
      </div>
    </>
  );
}

function useRemoteAccess(open: boolean) {
  const [access, setAccess] = useState<RemoteAccess | null | undefined>(undefined);
  const load = useCallback(() => {
    setAccess(undefined);
    fetchRemoteAccess().then(setAccess, () => setAccess(null));
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  return { access, load };
}

function usePcSettings(open: boolean) {
  const [pcSettings, setPcSettings] = useState<MachineSettings | null>(null);
  const [pcSettingsError, setPcSettingsError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    machineRequest<MachineSettings>("/settings").then(setPcSettings, () => setPcSettings(null));
  }, [open]);
  const updatePcSettings = async (patch: Partial<MachineSettings>) => {
    try { setPcSettings(await machineRequest<MachineSettings>("/settings", "PATCH", patch)); setPcSettingsError(null); }
    catch (e) { setPcSettingsError(e instanceof Error ? e.message : String(e)); }
  };
  return { pcSettings, pcSettingsError, updatePcSettings };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function VoiceTab({ open }: { open: boolean }) {
  const { settings, update } = useSettings();
  const t = useT();
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [voiceKey, setVoiceKey] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  useEffect(() => {
    if (open) fetchVoiceStatus().then(setVoice, () => setVoice(null));
  }, [open]);
  const toggleVoiceInput = async (voiceInput: boolean) => {
    update({ voiceInput });
    setMicDenied(false);
    if (!voiceInput || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
    try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((track) => track.stop()); }
    catch { setMicDenied(true); }
  };
  const changeVoiceKey = async (api_key: string | null) => {
    setVoiceBusy(true);
    try {
      const saved = await saveVoiceConfig({ api_key });
      setVoiceKey("");
      setVoiceError(null);
      setVoice(saved);
      window.dispatchEvent(new Event(VOICE_CONFIG_EVENT));
    } catch (e) { setVoiceError(errorText(e)); }
    finally { setVoiceBusy(false); }
  };
  const keyStatus = voice?.configured ? t(voice.source === "env" ? "OpenAI key set by HERDR_WEB_OPENAI_API_KEY" : "OpenAI key saved on this PC") : t("No OpenAI key: the browser's speech recognition is used");
  return (
    <>
      <SettingsSection className="voice-settings" title={t("Microphone")}>
        <InlineRow label={t("Microphone button")} description={t("In the chat composer and the terminal input line")}>
          <SettingSwitch label={t("Microphone button")} checked={settings.voiceInput} onChange={(voiceInput) => void toggleVoiceInput(voiceInput)} />
        </InlineRow>
        {settings.voiceInput && !window.isSecureContext && <SettingNote alert>{t("Voice input needs HTTPS")}</SettingNote>}
        {settings.voiceInput && window.isSecureContext && micDenied && <SettingNote alert>{t("Microphone permission was denied")}</SettingNote>}
      </SettingsSection>
      <SettingsSection title={t("OpenAI API key")}>
        {voice && <SettingDescription>{keyStatus}</SettingDescription>}
        {voice && voice.source !== "env" && (
          <form className="voice-key flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (voiceKey.trim()) void changeVoiceKey(voiceKey.trim()); }}>
            <input
              className={cn("voice-key-input min-w-40 flex-1", SETTINGS_INPUT)}
              type="password"
              value={voiceKey}
              placeholder="sk-..."
              aria-label={t("OpenAI API key")}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => setVoiceKey(event.target.value)}
            />
            <Button type="submit" className="text-ui" disabled={voiceBusy || !voiceKey.trim()}>{t("Save key")}</Button>
            <Button type="button" variant="ghost" className="text-ui text-muted-foreground" disabled={voiceBusy || !voice.configured} onClick={() => void changeVoiceKey(null)}>{t("Remove key")}</Button>
          </form>
        )}
        {voiceError && <SettingNote alert>{voiceError}</SettingNote>}
        <SettingNote>
          {voice && !voice.configured
            ? t("Without a key the browser recognizes the speech: Chrome and Edge send the audio to Google or Microsoft. Nothing is recorded until you press the mic.")
            : t("Audio is sent to OpenAI with your key. Nothing is recorded until you press the mic.")}
        </SettingNote>
      </SettingsSection>
      {settings.voiceInput && (
        <SettingsSection title={t("Tidy dictated text")}>
          <InlineRow label={t("In chat")} description={t("Drops fillers and fixes spacing; code and paths stay as spoken")}>
            <SettingSwitch label={t("Tidy dictated text in chat")} checked={settings.voicePolishChat} onChange={(voicePolishChat) => update({ voicePolishChat })} />
          </InlineRow>
          <InlineRow label={t("In the terminal")} description={t("Off keeps a command exactly as transcribed")}>
            <SettingSwitch label={t("Tidy dictated text in the terminal")} checked={settings.voicePolishTerminal} onChange={(voicePolishTerminal) => update({ voicePolishTerminal })} />
          </InlineRow>
        </SettingsSection>
      )}
    </>
  );
}

function AppearanceTab() {
  const { settings, update, resolvedTheme } = useSettings();
  const t = useT();
  const darkOnly = !hasLightMode(settings.palette);
  const paletteLabel = THEMES.find((theme) => theme.id === settings.palette)?.label ?? settings.palette;
  const modes: Choice<ThemeSetting>[] = [{ id: "dark", label: t("Dark") }, { id: "light", label: t("Light") }, { id: "system", label: t("System") }];
  const densities: Choice<Settings["density"]>[] = [{ id: "comfortable", label: t("Comfortable") }, { id: "compact", label: t("Compact") }];
  const languages: Choice<Settings["language"]>[] = LANGUAGE_SETTINGS.map((id) => ({ id, label: id === "system" ? t("System") : LANGUAGE_NAMES[id] }));
  const groupings: Choice<Settings["sidebarGrouping"]>[] = [{ id: "workspace", label: t("By workspace") }, { id: "directory", label: t("By folder") }];
  return (
    <SettingsSection>
      <InlineRow label={t("Theme")} description={darkOnly ? t("{theme} only comes in dark", { theme: paletteLabel }) : t("Choose the app color scheme")}>
        <ChoicePills label={t("Theme")} value={darkOnly ? "dark" : settings.theme} options={modes} disabled={darkOnly} onChange={(theme) => update({ theme })} />
      </InlineRow>
      <StackedRow label={t("Colors")} description={t("One palette for the app and the terminal")}>
        <ThemeSwatches label={t("Colors")} value={settings.palette} mode={resolvedTheme} onChange={(palette) => update({ palette })} />
      </StackedRow>
      <InlineRow label={t("Density")} description={t("Adjust spacing throughout the interface")}>
        <ChoicePills label={t("Density")} value={settings.density} options={densities} onChange={(density) => update({ density })} />
      </InlineRow>
      <InlineRow label={t("Interface text size")} description={t("Menus, the header and the sidebar")}>
        <Stepper label={t("Interface text size")} value={uiFontSize(settings)} min={UI_FONT_MIN} max={UI_FONT_MAX} unit="px" decreaseLabel={t("Smaller interface text")} increaseLabel={t("Larger interface text")} onChange={(size) => update({ uiFontSize: size })} />
      </InlineRow>
      <StackedRow label={t("Interface font")} description={t("Fonts installed on this PC work on every device. Type any name; a missing font falls back to the default.")}>
        <FontFamilyInput value={settings.uiFontFamily} label={t("Interface font")} onCommit={(uiFontFamily) => update({ uiFontFamily })} />
      </StackedRow>
      <StackedRow label={t("Language")} description={t("Follows the browser unless you choose one")}>
        <ChoicePills label={t("Language")} value={settings.language} options={languages} onChange={(language) => update({ language })} />
      </StackedRow>
      <StackedRow label={t("Sidebar grouping")} description={t("Group sessions by workspace or by full folder path on each PC")}>
        <ChoicePills label={t("Sidebar grouping")} value={settings.sidebarGrouping} options={groupings} onChange={(sidebarGrouping) => update({ sidebarGrouping })} />
      </StackedRow>
    </SettingsSection>
  );
}

function TerminalTab() {
  const { settings, update } = useSettings();
  const t = useT();
  const cursors: Choice<TerminalCursor>[] = [{ id: "block", label: t("Block") }, { id: "bar", label: t("Bar") }, { id: "underline", label: t("Underline") }];
  const inputModes: Choice<Settings["terminalInputMode"]>[] = [{ id: "auto", label: t("Automatic") }, { id: "line", label: t("Input line") }, { id: "direct", label: t("Direct typing") }];
  return (
    <SettingsSection>
      <InlineRow label={t("Terminal font size")} description={t("Applied to every terminal pane")}>
        <Stepper label={t("Terminal font size")} value={settings.terminalFontSize} min={TERMINAL_FONT_MIN} max={TERMINAL_FONT_MAX} unit="px" decreaseLabel={t("Decrease terminal font size")} increaseLabel={t("Increase terminal font size")} onChange={(terminalFontSize) => update({ terminalFontSize })} />
      </InlineRow>
      <StackedRow label={t("Terminal font")} description={t("Comma-separated, tried in order. A font this device does not have falls back to the default.")}>
        <FontFamilyInput value={settings.terminalFontFamily} label={t("Terminal font")} monoOnly onCommit={(terminalFontFamily) => update({ terminalFontFamily })} />
      </StackedRow>
      <InlineRow label={t("Wheel scroll speed")} description={t("How far one turn of the wheel scrolls the terminal")}>
        <Stepper label={t("Wheel scroll speed")} value={settings.terminalWheelSpeed} min={TERMINAL_WHEEL_SPEED_MIN} max={TERMINAL_WHEEL_SPEED_MAX} unit="×" decreaseLabel={t("Slower wheel scrolling")} increaseLabel={t("Faster wheel scrolling")} onChange={(terminalWheelSpeed) => update({ terminalWheelSpeed })} />
      </InlineRow>
      <InlineRow label={t("GPU rendering")} description={t("Draws the terminal with WebGL for smoother scrolling. Turn off if characters look misaligned.")}>
        <SettingSwitch label={t("GPU rendering")} checked={settings.terminalGpu} onChange={(terminalGpu) => update({ terminalGpu })} />
      </InlineRow>
      <InlineRow label={t("Cursor shape")} description={t("How the terminal marks where you type")}>
        <ChoicePills label={t("Cursor shape")} value={settings.terminalCursorStyle} options={cursors} onChange={(terminalCursorStyle) => update({ terminalCursorStyle })} />
      </InlineRow>
      <InlineRow label={t("Blinking cursor")} description={t("Turn off if the blink is distracting")}>
        <SettingSwitch label={t("Blinking cursor")} checked={settings.terminalCursorBlink} onChange={(terminalCursorBlink) => update({ terminalCursorBlink })} />
      </InlineRow>
      <StackedRow label={t("Terminal input mode")}>
        <ChoicePills label={t("Terminal input mode")} value={settings.terminalInputMode} options={inputModes} onChange={(terminalInputMode) => update({ terminalInputMode })} />
      </StackedRow>
    </SettingsSection>
  );
}

function ChatTab() {
  const { settings, update } = useSettings();
  const t = useT();
  const views: Choice<Settings["defaultView"]>[] = [{ id: "auto", label: t("Auto") }, { id: "chat", label: t("Chat") }, { id: "terminal", label: t("Terminal") }];
  const changeDefaultView = (defaultView: Settings["defaultView"]): void => {
    if (settings.defaultView === defaultView) return;
    forgetPaneViews();
    update({ defaultView });
  };
  return (
    <>
      <SettingsSection>
        <StackedRow label={t("Panes open in")} description={t("Every pane on this device. Switching a pane's lens keeps it there until this changes. Auto: chat for an agent on a touch screen, else the terminal.")}>
          <ChoicePills label={t("Panes open in")} value={settings.defaultView} options={views} onChange={changeDefaultView} />
        </StackedRow>
        <InlineRow label={t("Show thinking")} description={t("Include the agent's reasoning blocks")}>
          <SettingSwitch label={t("Show thinking")} checked={settings.showThinking} onChange={(showThinking) => update({ showThinking })} />
        </InlineRow>
        <InlineRow label={t("Chat font size")} description={t("Messages, code and prompt cards in the chat view")}>
          <Stepper label={t("Chat font size")} value={chatFontSize(settings)} min={CHAT_FONT_MIN} max={CHAT_FONT_MAX} unit="px" decreaseLabel={t("Decrease chat font size")} increaseLabel={t("Increase chat font size")} onChange={(size) => update({ chatFontSize: size })} />
        </InlineRow>
        <StackedRow label={t("Chat font")} description={t("Message text; code stays monospace. Comma-separated, tried in order. A font this device does not have falls back to the default.")}>
          <FontFamilyInput value={settings.chatFontFamily} label={t("Chat font")} onCommit={(chatFontFamily) => update({ chatFontFamily })} />
        </StackedRow>
      </SettingsSection>
      <SettingsSection title={t("Composer")}>
        <InlineRow label={t("Enter sends")} description={t("When off, Mod+Enter sends")}>
          <SettingSwitch label={t("Enter sends")} checked={settings.enterSends} onChange={(enterSends) => update({ enterSends })} />
        </InlineRow>
        <InlineRow label={t("Suggestion chip")} description={t("On a touch screen, a chip above the message box puts the prompt Claude Code suggests next into the box. With a keyboard, Tab does it.")}>
          <SettingSwitch label={t("Suggestion chip")} checked={settings.showSuggestionChip} onChange={(showSuggestionChip) => update({ showSuggestionChip })} />
        </InlineRow>
      </SettingsSection>
      <SettingsSection title={t("Quick replies")}>
        <InlineRow label={t("Show above the message box")} description={t("One-tap messages above the message box, on this device. Each is sent as if typed: queued while the agent works, an answer when a question is open.")}>
          <SettingSwitch label={t("Show above the message box")} checked={settings.showQuickReplies} onChange={(showQuickReplies) => update({ showQuickReplies })} />
        </InlineRow>
        <QuickReplies />
      </SettingsSection>
    </>
  );
}

function AlertsTab({ onEnableNotifications }: { onEnableNotifications: () => Promise<boolean> }) {
  const { settings, update } = useSettings();
  const t = useT();
  const finished: Choice<Settings["alertDone"]>[] = [{ id: "off", label: t("Off") }, { id: "long", label: t("Long turns") }, { id: "always", label: t("Every turn") }];
  return (
    <SettingsSection>
      <SettingDescription>{t("For this device. An alert waits a little first, and none comes when the pane changes meanwhile, as when you answer at the PC.")}</SettingDescription>
      <PushTestControls onEnable={onEnableNotifications} />
      <InlineRow label={t("Needs input")} description={t("An agent waits for an answer or a permission")}>
        <SettingSwitch label={t("Needs input")} checked={settings.alertInput} onChange={(alertInput) => update({ alertInput })} />
      </InlineRow>
      <StackedRow label={t("Finished")} description={t("Long turns: only work that took a minute or more")}>
        <ChoicePills label={t("Finished")} value={settings.alertDone} options={finished} onChange={(alertDone) => update({ alertDone })} />
      </StackedRow>
      <InlineRow label={t("In the app")} description={t("While the app is open, these drop in from the top of the screen at once. Tap one to open its pane.")}>
        <SettingSwitch label={t("In the app")} checked={settings.alertInApp} onChange={(alertInApp) => update({ alertInApp })} />
      </InlineRow>
    </SettingsSection>
  );
}

function UsageTab({ open }: { open: boolean }) {
  const { settings, update } = useSettings();
  const t = useT();
  const usage = useUsage(open && settings.showUsage);
  const counts: Choice<Settings["usageCount"]>[] = [{ id: "used", label: t("Used") }, { id: "left", label: t("Remaining") }];
  const placements: Choice<Settings["usagePlacement"]>[] = [{ id: "footer", label: t("Beside Settings") }, { id: "top", label: t("Top of the list") }];
  const providers = usage.report?.providers ?? [];
  return (
    <SettingsSection title={t("Subscription usage")}>
      <InlineRow label={t("Show plan limits")} description={t("Beside Settings, how much of each plan the AI tools on the server's PC have used. Turning it on sends their sign-ins to each provider's usage endpoint; they are never refreshed here.")}>
        <SettingSwitch label={t("Show plan limits")} checked={settings.showUsage} onChange={(showUsage) => update({ showUsage })} />
      </InlineRow>
      {settings.showUsage && (
        <>
          <InlineRow label={t("Meters show")}>
            <ChoicePills label={t("Meters show")} value={settings.usageCount} options={counts} onChange={(usageCount) => update({ usageCount })} />
          </InlineRow>
          <StackedRow label={t("Where")}>
            <ChoicePills label={t("Where")} value={settings.usagePlacement} options={placements} onChange={(usagePlacement) => update({ usagePlacement })} />
          </StackedRow>
          {providers.length > 0 && <UsageAccounts providers={providers} />}
        </>
      )}
    </SettingsSection>
  );
}

function ShortcutsTab() {
  const { update } = useSettings();
  const t = useT();
  return (
    <SettingsSection>
      <div className="flex items-start justify-between gap-4">
        <SettingDescription>{t("Some keys are reserved by the browser. Changes apply to this device.")}</SettingDescription>
        <Button variant="outline" size="sm" className="text-ui" onClick={() => update({ shortcutOverrides: {} })}>{t("Reset shortcuts")}</Button>
      </div>
      <div className="settings-shortcuts flex flex-col gap-1">
        {SHORTCUTS.map((shortcut) => <ShortcutRow key={shortcut.id} shortcut={shortcut} />)}
      </div>
    </SettingsSection>
  );
}

function PhoneTab({ open, auth }: { open: boolean; auth: HealthAuth | null }) {
  const { settings, update } = useSettings();
  const t = useT();
  const installPrompt = useInstallPrompt();
  const { access, load } = useRemoteAccess(open);
  const plan = phonePlan({ protocol: window.location.protocol, hostname: window.location.hostname, origin: window.location.origin, secure: window.isSecureContext }, access ?? null);
  const pairUrl = plan.kind === "here" || plan.kind === "served" ? plan.url : isLoopbackHost(window.location.hostname) ? null : window.location.origin;
  return (
    <>
      <SettingsSection title={t("Phone")}>
        <InlineRow label={t("Keep screen on")} description={t("While a terminal or chat pane is open. Requires HTTPS or localhost and a supported browser.")}>
          <SettingSwitch label={t("Keep screen on")} checked={settings.keepScreenOn} onChange={(keepScreenOn) => update({ keepScreenOn })} />
        </InlineRow>
        <PhonePanel plan={plan} loading={access === undefined} onRefresh={load} />
      </SettingsSection>
      <SettingsSection title={t("Devices")}>
        <DevicesPanel pairUrl={pairUrl} auth={auth} />
      </SettingsSection>
      <SettingsSection title={t("Install")}>
        {installPrompt.installed ? <SettingNote>{t("Installed")}</SettingNote> : installPrompt.canInstall ? (
          <Button className="w-fit text-ui" onClick={() => void installPrompt.install()}>{t("Install app")}</Button>
        ) : <SettingNote>{installPrompt.help}</SettingNote>}
      </SettingsSection>
    </>
  );
}

function AboutTab({ open, updates }: { open: boolean; updates: UpdatesModel }) {
  const t = useT();
  const { pcSettings, pcSettingsError, updatePcSettings } = usePcSettings(open);
  return (
    <>
      <SettingsSection className="settings-about" title={t("About")}>
        <span className="text-ui font-medium">herdr web ui</span>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm" className="text-ui">
            <a href="https://github.com/devswha/herdr-web-ui" target="_blank" rel="noreferrer"><Star aria-hidden="true" />{t("Star on GitHub")}</a>
          </Button>
          <a className="text-ui text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="https://devswha.github.io/herdr-web-ui/" target="_blank" rel="noreferrer">devswha.github.io/herdr-web-ui</a>
        </div>
      </SettingsSection>
      {pcSettings && (
        <SettingsSection title={t("Remote PCs")}>
          <InlineRow label={t("Update PC bridges automatically")} description={t("When an app update needs a newer bridge, PCs that connect with their saved key are updated in the background. PCs that need a password ask first.")}>
            <SettingSwitch label={t("Update PC bridges automatically")} checked={pcSettings.auto_update_bridges} onChange={(auto_update_bridges) => void updatePcSettings({ auto_update_bridges })} />
          </InlineRow>
          {pcSettingsError && <SettingNote alert>{pcSettingsError}</SettingNote>}
        </SettingsSection>
      )}
      <UpdateControls updates={updates} bridgesFollow={pcSettings?.auto_update_bridges === true} />
    </>
  );
}

export function SettingsDialog({ open, onClose, updates, auth, onEnableNotifications }: SettingsDialogProps) {
  const t = useT();
  const [tab, setTab] = useState<TabId>(FIRST_TAB);
  useEffect(() => { if (!open) setTab(FIRST_TAB); }, [open]);
  const tabs: SettingsTab<TabId>[] = [
    { id: "appearance", label: t("Appearance") },
    { id: "terminal", label: t("Terminal") },
    { id: "chat", label: t("Chat") },
    { id: "voice", label: t("Voice input") },
    { id: "alerts", label: t("Alerts") },
    { id: "usage", label: t("Usage") },
    { id: "shortcuts", label: t("Shortcuts") },
    { id: "phone", label: t("Phone") },
    { id: "about", label: t("About") },
  ];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent phoneSheet closeLabel={t("Close settings")} aria-describedby={undefined} className="settings-dialog max-w-176 gap-0 max-md:grid-rows-[minmax(0,1fr)]">
        <SettingsTabs title={<DialogTitle className="px-2">{t("Settings")}</DialogTitle>} tabs={tabs} value={tab} onChange={setTab}>
          {tab === "appearance" && <AppearanceTab />}
          {tab === "terminal" && <TerminalTab />}
          {tab === "chat" && <ChatTab />}
          {tab === "voice" && <VoiceTab open={open} />}
          {tab === "alerts" && <AlertsTab onEnableNotifications={onEnableNotifications} />}
          {tab === "usage" && <UsageTab open={open} />}
          {tab === "shortcuts" && <ShortcutsTab />}
          {tab === "phone" && <PhoneTab open={open} auth={auth} />}
          {tab === "about" && <AboutTab open={open} updates={updates} />}
        </SettingsTabs>
      </DialogContent>
    </Dialog>
  );
}
