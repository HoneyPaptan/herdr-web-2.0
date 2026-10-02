import type { ITheme } from "@xterm/xterm";

export type ThemeName = "gruvbox" | "default" | "catppuccin" | "one-dark-pro" | "cobalt2";
export type Mode = "light" | "dark";

export interface Theme {
  id: ThemeName;
  label: string;
  darkOnly?: boolean;
  credit?: { name: string; url: string };
}

export const THEMES: readonly Theme[] = [
  { id: "gruvbox", label: "Gruvbox", credit: { name: "gruvbox", url: "https://github.com/morhetz/gruvbox" } },
  { id: "default", label: "Dray" },
  { id: "catppuccin", label: "Catppuccin", credit: { name: "Catppuccin", url: "https://github.com/catppuccin/catppuccin" } },
  { id: "one-dark-pro", label: "One Dark Pro", darkOnly: true, credit: { name: "One Dark Pro", url: "https://github.com/Binaryify/OneDark-Pro" } },
  { id: "cobalt2", label: "Cobalt2", darkOnly: true, credit: { name: "Cobalt2", url: "https://github.com/wesbos/cobalt2-vscode" } },
];

export const DEFAULT_THEME: ThemeName = "gruvbox";

export function hasLightMode(name: ThemeName): boolean {
  return !THEMES.find((theme) => theme.id === name)?.darkOnly;
}

export function modeFor(name: ThemeName, mode: Mode): Mode {
  return hasLightMode(name) ? mode : "dark";
}

export function coerceTheme(raw: unknown): ThemeName {
  return THEMES.some((theme) => theme.id === raw) ? (raw as ThemeName) : DEFAULT_THEME;
}

type Ansi = Pick<ITheme, "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow" | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite">;

function ansi(colors: string): Ansi {
  const [black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite] = colors.split(" ");
  return { black, red, green, yellow, blue, magenta, cyan, white, brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite };
}

function surface(background: string, foreground: string, selectionBackground: string, cursor = foreground): ITheme {
  return { background, foreground, cursor, cursorAccent: background, selectionBackground };
}

const GRUVBOX_DARK = ansi("#1d2021 #cc241d #98971a #d79921 #458588 #b16286 #689d6a #a89984 #928374 #fb4934 #b8bb26 #fabd2f #83a598 #d3869b #8ec07c #ebdbb2");
const GRUVBOX_LIGHT = ansi("#fbf1c7 #cc241d #98971a #d79921 #458588 #b16286 #689d6a #7c6f64 #928374 #9d0006 #79740e #b57614 #076678 #8f3f71 #427b58 #3c3836");
const CATPPUCCIN_MOCHA = ansi("#45475a #f38ba8 #a6e3a1 #f9e2af #89b4fa #f5c2e7 #94e2d5 #bac2de #585b70 #f7aec2 #c2ecbf #fcd682 #aeccfc #f398da #b1eae1 #a6adc8");
const CATPPUCCIN_LATTE = ansi("#bcc0cc #d20f39 #40a02b #df8e1d #1e66f5 #ea76cb #179299 #5c5f77 #acb0be #e7103f #46b02f #e49931 #3878f6 #ef95d7 #19a1a8 #6c6f85");
const ONE_DARK = ansi("#21252b #e06c75 #98c379 #e5c07b #61afef #c678dd #56b6c2 #abb2bf #767676 #e06c75 #98c379 #e5c07b #61afef #c678dd #56b6c2 #abb2bf");
const COBALT2 = ansi("#000000 #ff0000 #38de21 #ffe50a #1460d2 #ff005d #00bbbb #bbbbbb #555555 #f40e17 #3bd01d #edc809 #5555ff #ff55ff #6ae3fa #ffffff");

const TERMINAL_THEMES: Record<ThemeName, Record<Mode, ITheme>> = {
  gruvbox: {
    dark: { ...surface("#1d2021", "#ebdbb2", "#3c3836"), ...GRUVBOX_DARK },
    light: { ...surface("#fbf1c7", "#3c3836", "#ebdbb2"), ...GRUVBOX_LIGHT },
  },
  default: {
    dark: surface("#0a0a0a", "#fafafa", "#262626"),
    light: surface("#eef4fb", "#171b1f", "#e0e5eb"),
  },
  catppuccin: {
    dark: { ...surface("#181825", "#cdd6f4", "#45475a"), ...CATPPUCCIN_MOCHA },
    light: { ...surface("#e6e9ef", "#4c4f69", "#ccd0da"), ...CATPPUCCIN_LATTE },
  },
  "one-dark-pro": {
    dark: { ...surface("#1e2227", "#d7dae0", "#3e4452"), ...ONE_DARK },
    light: { ...surface("#1e2227", "#d7dae0", "#3e4452"), ...ONE_DARK },
  },
  cobalt2: {
    dark: { ...surface("#193549", "#ffffff", "#355166", "#ffc600"), ...COBALT2 },
    light: { ...surface("#193549", "#ffffff", "#355166", "#ffc600"), ...COBALT2 },
  },
};

export const TERMINAL_MIN_CONTRAST = 4.5;

export function terminalTheme(name: ThemeName, mode: Mode): ITheme {
  return TERMINAL_THEMES[name][modeFor(name, mode)];
}

export function themeColor(name: ThemeName, mode: Mode): string {
  return terminalTheme(name, mode).background ?? "#000000";
}
