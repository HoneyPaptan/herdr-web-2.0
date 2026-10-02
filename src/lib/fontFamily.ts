
const TERMINAL_SYMBOLS_FONT = '"Symbols Nerd Font Mono"';
const BUNDLED_TERMINAL_FONT = '"JetBrains Mono Variable"';
const SYSTEM_TERMINAL_FONTS =
  '"JetBrains Mono", "Fira Code", "D2Coding", Menlo, Monaco, "Cascadia Mono", Consolas, "Noto Sans Mono CJK KR", monospace, "Malgun Gothic"';
const TERMINAL_TEXT_FONTS = `${BUNDLED_TERMINAL_FONT}, ${SYSTEM_TERMINAL_FONTS}`;
export const TERMINAL_FONT_STACK = `${TERMINAL_SYMBOLS_FONT}, ${TERMINAL_TEXT_FONTS}`;
const TERMINAL_FALLBACK_STACK = `${TERMINAL_SYMBOLS_FONT}, ${SYSTEM_TERMINAL_FONTS}`;

export function terminalBootStack(sizePx: number): string {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts || typeof fonts.check !== "function") return TERMINAL_FONT_STACK;
  return fonts.check(`${sizePx}px ${BUNDLED_TERMINAL_FONT}`) ? TERMINAL_FONT_STACK : TERMINAL_FALLBACK_STACK;
}

const CHAT_FONT_STACK = "var(--font-ui)";

export const FONT_FAMILY_MAX_CHARS = 200;

export const FONT_LOAD_TIMEOUT_MS = 3000;

const UNSAFE_CHARS = /[;{}<>\\\u0000-\u001f\u007f]/g;
const QUOTES = /["']/g;
const IDENTIFIER = /^-?[A-Za-z_\u0080-￿][\w\u0080-￿-]*$/;
const RESERVED = new Set(["inherit", "initial", "unset", "revert", "revert-layer", "default"]);

function normalizeName(raw: string): string {
  const trimmed = raw.trim();
  const quoted = trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0];
  const name = (quoted ? trimmed.slice(1, -1) : trimmed).replace(QUOTES, "").replace(/\s+/g, " ").trim();
  if (name === "") return "";
  return quoted || !IDENTIFIER.test(name) || RESERVED.has(name.toLowerCase()) ? `"${name}"` : name;
}

export function sanitizeFontFamily(value: unknown): string {
  if (typeof value !== "string") return "";
  const names = value.normalize("NFC").replace(UNSAFE_CHARS, "").split(",").map(normalizeName).filter((name) => name !== "");
  let family = "";
  for (const name of names) {
    const next = family === "" ? name : `${family}, ${name}`;
    if (next.length > FONT_FAMILY_MAX_CHARS) break;
    family = next;
  }
  return family;
}

export function terminalFontStack(family: string): string {
  const chosen = sanitizeFontFamily(family);
  return chosen === "" ? TERMINAL_FONT_STACK : `${TERMINAL_SYMBOLS_FONT}, ${chosen}, ${TERMINAL_TEXT_FONTS}`;
}

export function uiFontStack(family: string): string | null {
  const chosen = sanitizeFontFamily(family);
  return chosen === "" ? null : `${chosen}, var(--font-ui-default)`;
}

export function chatFontStack(family: string): string | null {
  const chosen = sanitizeFontFamily(family);
  return chosen === "" ? null : `${chosen}, ${CHAT_FONT_STACK}`;
}

const FONT_LOAD_SAMPLE = "Mg가";

export async function loadFontStack(stack: string, sizePx: number, timeoutMs = FONT_LOAD_TIMEOUT_MS): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts || typeof fonts.load !== "function") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fonts.load(`${sizePx}px ${stack}`, FONT_LOAD_SAMPLE),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } catch {
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
