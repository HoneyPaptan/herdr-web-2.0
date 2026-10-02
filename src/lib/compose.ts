import type { AgentStatus, SlashCommand } from "../../shared/protocol.ts";
import { knownStatus, STATUS_WORD } from "./status.ts";
import { t } from "./i18n.ts";

export const MAX_COMPOSER_CHARS = 20_000;

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

export function composerMessage(text: string): string {
  return text.replace(/[\r\n]+$/, "").replace(/\r\n?/g, "\n");
}

export function composerPayload(text: string, bracketedPaste: boolean): string {
  const body = composerMessage(text).replace(/\n/g, "\r");
  return bracketedPaste ? PASTE_START + body + PASTE_END : body;
}

export function submitNote(code: string, message: string): string {
  if (code === "agent_blocked") return t("Not sent: the agent is waiting for an answer in the terminal. Answer it first.");
  if (code === "read_only") return t("Not sent: this view only watches the pane.");
  if (code === "submit_timeout") return t("Not sent: it waited too long behind an earlier message, and nothing was typed. Send it again.");
  if (code === "disconnected" || code === "timeout") return t("Not confirmed: the pane did not confirm this message. Check the terminal before sending it again.");
  return t("Not sent: {message}", { message });
}

export function imageMention(path: string): string {
  return `@${path} `;
}

export function insertMention(
  text: string,
  start: number,
  end: number,
  mention: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const snippet = before.length > 0 && !/\s$/u.test(before) ? ` ${mention}` : mention;
  const room = Math.max(0, MAX_COMPOSER_CHARS - text.length + end - start);
  const inserted = snippet.slice(0, room);
  return { text: before + inserted + text.slice(end), caret: start + inserted.length };
}

export const QUEUE_READY_STATUS: Readonly<Partial<Record<string, true>>> = { done: true, idle: true };

const TERMINAL_ONLY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  tree: ["pi", "omp"],
};

export function terminalOnlyCommand(agent: string | null, text: string): string | null {
  if (agent === null) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const [word] = trimmed.slice(1).toLowerCase().split(/\s+/);
  const agents = TERMINAL_ONLY_COMMANDS[word ?? ""];
  return agents !== undefined && agents.includes(agent) ? (word ?? null) : null;
}

export function composerStatusWord(status?: AgentStatus): string {
  const known = knownStatus(status);
  return known === "unknown" ? STATUS_WORD.idle : STATUS_WORD[known];
}

export function agentDisplayLabel(agent: string | null): string {
  if (!agent) return "Shell";
  return agent
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function rankSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
  usage: Readonly<Partial<Record<string, number>>>,
): SlashCommand[] {
  const needle = query.toLocaleLowerCase();
  return commands
    .filter((command) => command.name.toLocaleLowerCase().startsWith(needle))
    .sort((left, right) => {
      const frequency = (usage[right.name] ?? 0) - (usage[left.name] ?? 0);
      return frequency || left.name.localeCompare(right.name);
    });
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function contextLeftPercent(context: { used: number; window: number | null }): number | null {
  if (context.window === null || context.window <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - context.used / context.window) * 100)));
}
