import { describe, expect, it } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FONT_FAMILY_MAX_CHARS } from "./fontFamily.ts";
import { alertPrefs, CHAT_FONT_MAX, CHAT_FONT_MIN, chatFontSize, DEFAULT_SETTINGS, QUICK_REPLIES_MAX, QUICK_REPLY_MAX_CHARS, quickReplyButtons, sanitizeSettings, forgetPaneViews, UI_FONT_MAX, UI_FONT_MIN, uiFontSize } from "./settings.ts";
import { coerceTheme, DEFAULT_THEME, modeFor, terminalTheme, themeColor, THEMES } from "./theme.ts";

it("clamps the interface text size and falls back to the theme size when unset", () => {
  expect(uiFontSize(DEFAULT_SETTINGS)).toBe(13);
  expect(sanitizeSettings({ uiFontSize: 15.4 }).uiFontSize).toBe(15);
  expect(sanitizeSettings({ uiFontSize: 99 }).uiFontSize).toBe(UI_FONT_MAX);
  expect(sanitizeSettings({ uiFontSize: 2 }).uiFontSize).toBe(UI_FONT_MIN);
  expect(sanitizeSettings({ uiFontSize: "14" }).uiFontSize).toBeNull();
});

it("keeps only the cursor shapes xterm knows and defaults to a blinking block", () => {
  expect(sanitizeSettings({}).terminalCursorStyle).toBe("block");
  expect(sanitizeSettings({}).terminalCursorBlink).toBe(true);
  expect(sanitizeSettings({ terminalCursorStyle: "bar", terminalCursorBlink: false })).toMatchObject({ terminalCursorStyle: "bar", terminalCursorBlink: false });
  expect(sanitizeSettings({ terminalCursorStyle: "beam" }).terminalCursorStyle).toBe("block");
});

it("keeps the screen wake lock off until this device explicitly enables it", () => {
  expect(DEFAULT_SETTINGS.keepScreenOn).toBe(false);
  expect(sanitizeSettings({}).keepScreenOn).toBe(false);
  expect(sanitizeSettings({ keepScreenOn: true }).keepScreenOn).toBe(true);
  expect(sanitizeSettings({ keepScreenOn: "true" }).keepScreenOn).toBe(false);
  // the terminal's wheel speed: one report per wheel event unless chosen, whole and bounded
  expect(sanitizeSettings({}).terminalWheelSpeed).toBe(1);
  expect(sanitizeSettings({ terminalWheelSpeed: 3 }).terminalWheelSpeed).toBe(3);
  expect(sanitizeSettings({ terminalWheelSpeed: 2.6 }).terminalWheelSpeed).toBe(3);
  expect(sanitizeSettings({ terminalWheelSpeed: 99 }).terminalWheelSpeed).toBe(10);
  expect(sanitizeSettings({ terminalWheelSpeed: 0 }).terminalWheelSpeed).toBe(1);
  expect(sanitizeSettings({ terminalWheelSpeed: "3" }).terminalWheelSpeed).toBe(1);
});

it("defaults legacy records to workspace grouping and accepts only supported modes", () => {
  expect(sanitizeSettings({}).sidebarGrouping).toBe("workspace");
  expect(sanitizeSettings({ sidebarGrouping: "workspace" }).sidebarGrouping).toBe("workspace");
  expect(sanitizeSettings({ sidebarGrouping: "directory" }).sidebarGrouping).toBe("directory");
  for (const sidebarGrouping of [null, true, "folder", 1]) {
    expect(sanitizeSettings({ sidebarGrouping }).sidebarGrouping).toBe("workspace");
  }
});

describe("chat font size", () => {
  it("follows the density until one is chosen, and keeps a chosen one within bounds", () => {
    expect(chatFontSize(DEFAULT_SETTINGS)).toBe(14);
    expect(chatFontSize(sanitizeSettings({ density: "compact" }))).toBe(13);
    expect(chatFontSize(sanitizeSettings({ density: "compact", chatFontSize: 17 }))).toBe(17);
    expect(sanitizeSettings({ chatFontSize: 99 }).chatFontSize).toBe(CHAT_FONT_MAX);
    expect(sanitizeSettings({ chatFontSize: 2 }).chatFontSize).toBe(CHAT_FONT_MIN);
    expect(sanitizeSettings({ chatFontSize: 15.6 }).chatFontSize).toBe(16);
    expect(sanitizeSettings({ chatFontSize: "18" }).chatFontSize).toBeNull();
    expect(sanitizeSettings({ terminalFontSize: 15 }).chatFontSize).toBeNull();
  });
});

describe("font families", () => {
  const family = (value: unknown): string => sanitizeSettings({ terminalFontFamily: value }).terminalFontFamily;

  it("keep today's fonts until a list is typed, and ignore anything that is not text", () => {
    expect(DEFAULT_SETTINGS.terminalFontFamily).toBe("");
    expect(DEFAULT_SETTINGS.chatFontFamily).toBe("");
    expect(sanitizeSettings({}).terminalFontFamily).toBe("");
    expect(sanitizeSettings({}).chatFontFamily).toBe("");
    for (const value of [undefined, null, 7, true, ["D2Coding"], { name: "D2Coding" }]) expect(family(value)).toBe("");
    expect(family("")).toBe("");
    expect(family("   ")).toBe("");
    expect(family(" , ,, ")).toBe("");
  });

  it("trim each name, drop empty ones and join them the CSS way", () => {
    expect(family("  D2Coding  ")).toBe("D2Coding");
    expect(family("D2Coding,,  , monospace,")).toBe("D2Coding, monospace");
    expect(family(",D2Coding")).toBe("D2Coding");
  });

  it("quote names with spaces once, and keep quoted names quoted", () => {
    expect(family("Cascadia Mono")).toBe('"Cascadia Mono"');
    expect(family("  Cascadia    Mono  ")).toBe('"Cascadia Mono"');
    expect(family('D2Coding, "Cascadia Mono", monospace')).toBe('D2Coding, "Cascadia Mono", monospace');
    expect(family("'Cascadia Mono'")).toBe('"Cascadia Mono"');
    expect(family('" Cascadia Mono "')).toBe('"Cascadia Mono"');
    // quoted, a generic name is a font by that name: the user's quotes stay
    expect(family('"monospace"')).toBe('"monospace"');
    // a stray or unbalanced quote cannot end the CSS string early
    expect(family('Cascadia"Mono')).toBe("CascadiaMono");
    expect(family('"Cascadia Mono')).toBe('"Cascadia Mono"');
    expect(family('""')).toBe("");
  });

  it("quote what CSS cannot read bare", () => {
    expect(family("3270 Nerd Font")).toBe('"3270 Nerd Font"');
    expect(family("1942report")).toBe('"1942report"');
    expect(family("inherit, D2Coding")).toBe('"inherit", D2Coding');
    expect(family("나눔고딕코딩")).toBe("나눔고딕코딩");
    expect(family("Sarasa-Mono-K")).toBe("Sarasa-Mono-K");
  });

  it("compose a decomposed name, so it matches the installed font", () => {
    const decomposed = "나눔고딕코딩".normalize("NFD");
    expect(decomposed).not.toBe("나눔고딕코딩");
    expect(family(decomposed)).toBe("나눔고딕코딩");
    expect(family(`D2Coding, ${"나눔 고딕".normalize("NFD")}`)).toBe('D2Coding, "나눔 고딕"');
  });

  it("strip what could leave the declaration", () => {
    expect(family("D2Coding; color: red")).toBe('"D2Coding color: red"');
    expect(family("D2Coding} body { color: red")).toBe('"D2Coding body color: red"');
    expect(family("</style><script>x</script>")).toBe('"/stylescriptx/script"');
    expect(family("D2\\Coding")).toBe("D2Coding");
    expect(family("D2\u0000Coding\nMono\t")).toBe("D2CodingMono");
    for (const unsafe of [";", "{", "}", "<", ">", "\\", "\u0000", "\u001f", "\u007f"]) expect(family(`x${unsafe}y`)).toBe("xy");
  });

  it("stay within the length limit, dropping whole names past it", () => {
    const long = Array.from({ length: 40 }, (_, index) => `Font Name ${index}`).join(", ");
    const kept = family(long);
    expect(kept.length).toBeLessThanOrEqual(FONT_FAMILY_MAX_CHARS);
    expect(kept.startsWith('"Font Name 0", "Font Name 1"')).toBe(true);
    // every name that made it is whole: its quotes pair up
    expect(kept.split(", ").every((name) => /^"Font Name \d+"$/.test(name))).toBe(true);
    expect(family("x".repeat(FONT_FAMILY_MAX_CHARS + 1))).toBe("");
    expect(family("x".repeat(FONT_FAMILY_MAX_CHARS))).toBe("x".repeat(FONT_FAMILY_MAX_CHARS));
  });

  it("are the same list after a second pass, so a saved one never drifts", () => {
    for (const typed of ['D2Coding, "Cascadia Mono", monospace', "'Fira Code' ,  Menlo", "inherit, 3270 Nerd Font"]) {
      const once = family(typed);
      expect(family(once)).toBe(once);
    }
  });

  it("sanitize the chat's list the same way, apart from the terminal's", () => {
    const both = sanitizeSettings({ terminalFontFamily: "D2Coding", chatFontFamily: " Pretendard ; , Noto Sans KR" });
    expect(both.terminalFontFamily).toBe("D2Coding");
    expect(both.chatFontFamily).toBe('Pretendard, "Noto Sans KR"');
  });
});

describe("alert choices", () => {
  it("keep alerts on unless this device turned them off with the bell", () => {
    expect(DEFAULT_SETTINGS.alertsOn).toBe(true);
    expect(sanitizeSettings({}).alertsOn).toBe(true);
    expect(sanitizeSettings({ alertsOn: false }).alertsOn).toBe(false);
    expect(sanitizeSettings({ alertsOn: "no" }).alertsOn).toBe(true);
  });

  it("default to questions and long turns, and drop anything unknown to the default", () => {
    expect(alertPrefs(DEFAULT_SETTINGS)).toEqual({ input: true, done: "long" });
    expect(alertPrefs(sanitizeSettings({ alertInput: false, alertDone: "always" }))).toEqual({ input: false, done: "always" });
    expect(alertPrefs(sanitizeSettings({ alertInput: "no", alertDone: "sometimes" }))).toEqual({ input: true, done: "long" });
  });
});

describe("quick replies", () => {
  it("keep replies as typed, bounded, and show only the ones with something to send", () => {
    expect(quickReplyButtons(DEFAULT_SETTINGS)).toEqual(["continue", "yes", "no", "commit and push", "retry"]);
    // a trailing space is the next word being typed: it stays
    const typed = sanitizeSettings({ quickReplies: ["run the ", "", "  ", 7, "ship it"] });
    expect(typed.quickReplies).toEqual(["run the ", "", "  ", "ship it"]);
    expect(quickReplyButtons(typed)).toEqual(["run the ", "ship it"]);
    const many = sanitizeSettings({ quickReplies: Array.from({ length: 20 }, (_, index) => "x".repeat(300) + index) });
    expect(many.quickReplies).toHaveLength(QUICK_REPLIES_MAX);
    expect(many.quickReplies.every((reply) => reply.length === QUICK_REPLY_MAX_CHARS)).toBe(true);
    // an emptied list is a choice, not a broken record
    expect(sanitizeSettings({ quickReplies: [] }).quickReplies).toEqual([]);
    expect(sanitizeSettings({}).quickReplies).toEqual(DEFAULT_SETTINGS.quickReplies);
  });
});

describe("suggestion chip", () => {
  it("stays off until chosen in settings", () => {
    expect(DEFAULT_SETTINGS.showSuggestionChip).toBe(false);
    expect(sanitizeSettings({}).showSuggestionChip).toBe(false);
    expect(sanitizeSettings({ showSuggestionChip: true }).showSuggestionChip).toBe(true);
    expect(sanitizeSettings({ showSuggestionChip: "yes" }).showSuggestionChip).toBe(false);
  });
});

describe("quick replies row", () => {
  it("stays hidden until chosen in settings", () => {
    expect(DEFAULT_SETTINGS.showQuickReplies).toBe(false);
    expect(sanitizeSettings({ showQuickReplies: true }).showQuickReplies).toBe(true);
    expect(sanitizeSettings({ showQuickReplies: "yes" }).showQuickReplies).toBe(false);
    expect(DEFAULT_SETTINGS.showUsage).toBe(false);
    expect(sanitizeSettings({ showUsage: true }).showUsage).toBe(true);
    expect(sanitizeSettings({ showUsage: 1 }).showUsage).toBe(false);
    expect(DEFAULT_SETTINGS.usageCount).toBe("used");
    expect(sanitizeSettings({ usageCount: "left" }).usageCount).toBe("left");
    expect(sanitizeSettings({ usageCount: "half" }).usageCount).toBe("used");
    expect(sanitizeSettings({ usageOrder: ["codex:a", 3, "codex:a", "", "claude:b"] }).usageOrder).toEqual(["codex:a", "claude:b"]);
    expect(sanitizeSettings({ usageHidden: Array.from({ length: 100 }, (_, index) => `k${index}`) }).usageHidden).toHaveLength(64);
    expect(sanitizeSettings({ usageHidden: "codex:a" }).usageHidden).toEqual([]);
  });
});

describe("palette", () => {
  it("defaults to gruvbox and maps unknown or retired palettes to it", () => {
    expect(DEFAULT_SETTINGS.palette).toBe("gruvbox");
    expect(sanitizeSettings({ theme: "light" }).palette).toBe("gruvbox");
    expect(sanitizeSettings({ palette: "catppuccin" }).palette).toBe("catppuccin");
    expect(sanitizeSettings({ palette: "amber" }).palette).toBe("gruvbox");
    expect(coerceTheme("pink")).toBe("gruvbox");
  });

  it("forces dark-only themes to dark and keeps light where the theme has one", () => {
    expect(modeFor("cobalt2", "light")).toBe("dark");
    expect(modeFor("one-dark-pro", "light")).toBe("dark");
    expect(modeFor("gruvbox", "light")).toBe("light");
    expect(terminalTheme("cobalt2", "light")).toBe(terminalTheme("cobalt2", "dark"));
  });

  it("keeps terminal text readable (WCAG AA 4.5:1) in every theme and mode", () => {
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const failures = THEMES.flatMap(({ id }) => (["dark", "light"] as const).filter((mode) => {
      const theme = terminalTheme(id, mode);
      return ratio(theme.foreground!, theme.background!) < 4.5;
    }).map((mode) => `${id}/${mode}`));
    expect(failures).toEqual([]);
  });

  it("paints the default theme before settings load", () => {
    const html = readFileSync(join(import.meta.dir, "..", "..", "index.html"), "utf8");
    expect(html).toContain(`"${DEFAULT_THEME}"`);
    expect(html).toContain(`content="${themeColor(DEFAULT_THEME, "dark")}"`);
  });
});

describe("agent marks", () => {
  it("drops the icon choice 0.3.36 stored, so every pane shows its provider logo", () => {
    const settings = sanitizeSettings({ claudeMark: "mascot", codexMark: "app" });
    expect(settings).not.toHaveProperty("claudeMark");
    expect(settings).not.toHaveProperty("codexMark");
  });
});

describe("plan meter placement", () => {
  it("sits beside Settings until the top of the list is chosen", () => {
    expect(DEFAULT_SETTINGS.usagePlacement).toBe("footer");
    expect(sanitizeSettings({ usagePlacement: "top" }).usagePlacement).toBe("top");
    expect(sanitizeSettings({ usagePlacement: "left" }).usagePlacement).toBe("footer");
  });
});

it("sanitizes input modes and shortcut overrides without accepting arbitrary commands", () => {
  expect(sanitizeSettings({ terminalInputMode: "bad" }).terminalInputMode).toBe("auto");
  expect(sanitizeSettings({ terminalInputMode: "line" }).terminalInputMode).toBe("line");
  expect(sanitizeSettings({ shortcutOverrides: { palette: "p", settings: null, voice: "x", unknown: "x", "next-pane": "rm -rf" } }).shortcutOverrides).toEqual({ palette: "p", settings: null });
});

describe("default lens", () => {
  it("keeps only a known choice, auto by default", () => {
    expect(DEFAULT_SETTINGS.defaultView).toBe("auto");
    expect(sanitizeSettings({ defaultView: "chat" }).defaultView).toBe("chat");
    expect(sanitizeSettings({ defaultView: "split" }).defaultView).toBe("auto");
  });
  it("forgets every pane's own lens and nothing else", () => {
    const data = new Map<string, string>([["herdr-web-ui:view:local:w1:p1", "terminal"], ["herdr-web-ui:view:remote:pc:w2:p1", "chat"], ["herdr-web-ui:settings", "{}"]]);
    const storage = { get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null, removeItem: (k: string) => { data.delete(k); } };
    expect(forgetPaneViews(storage)).toBe(2);
    expect([...data.keys()]).toEqual(["herdr-web-ui:settings"]);
  });
});
