import { describe, expect, test } from "bun:test";

import { answerKeys, parseInteractivePrompt, pendingClaudeDialog, type ClaudeDialog } from "./prompt.ts";

const user = (content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "user", isSidechain: false, ...extra, message: { role: "user", content } });
const call = (id: string, name: string, input: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", isSidechain: false, ...extra, message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string) => user([{ type: "tool_result", tool_use_id: id, content: "ok" }]);

const ROUTE = { header: "Route", question: "Which way should the PR go?", multiSelect: false, options: [{ label: "Log in as owner", description: "Open the PR directly on the repo." }, { label: "Fork", description: "Open the PR from a fork." }] };
const AUTHOR = { header: "Author", question: "Who should author the commits?", multiSelect: false, options: [{ label: "Keep local", description: null }, { label: "Repo owner", description: null }] };
const ask = (...questions: unknown[]): ClaudeDialog => ({ kind: "ask", questions: questions as Extract<ClaudeDialog, { kind: "ask" }>["questions"] });

describe("the dialog Claude's transcript waits on", () => {
  test("is the call without a result, in the turn the transcript is in", () => {
    const pending = [user("go"), call("a", "AskUserQuestion", { questions: [ROUTE] })].join("\n");
    expect(pendingClaudeDialog(pending)).toEqual(ask(ROUTE));
    // records Claude writes around it (titles, modes, snapshots) and a subagent's lines change nothing
    expect(pendingClaudeDialog([pending, JSON.stringify({ type: "ai-title" }), call("s", "ExitPlanMode", { plan: "x" }, { isSidechain: true }), "", "{cut"].join("\n"))).toEqual(ask(ROUTE));
    expect(pendingClaudeDialog([user("go"), call("p", "ExitPlanMode", { plan: "1. Add README.md" })].join("\n"))).toEqual({ kind: "plan", plan: "1. Add README.md" });
  });

  test("is null once its result is written, and for the newest of two calls", () => {
    expect(pendingClaudeDialog([user("go"), call("a", "AskUserQuestion", { questions: [ROUTE] }), result("a")].join("\n"))).toBeNull();
    expect(pendingClaudeDialog([user("go"), call("a", "AskUserQuestion", { questions: [ROUTE] }), result("a"), call("b", "AskUserQuestion", { questions: [AUTHOR] })].join("\n"))).toEqual(ask(AUTHOR));
    // other tools' calls and results after the answer do not reopen it
    expect(pendingClaudeDialog([user("go"), call("a", "AskUserQuestion", { questions: [ROUTE] }), result("a"), call("c", "Bash", { command: "ls" })].join("\n"))).toBeNull();
  });

  test("says nothing for a turn without such a call, or one of another shape", () => {
    expect(pendingClaudeDialog("")).toBeUndefined();
    expect(pendingClaudeDialog([call("a", "AskUserQuestion", { questions: [ROUTE] }), user("never mind, do this instead")].join("\n"))).toBeUndefined();
    expect(pendingClaudeDialog([user("go"), call("c", "Bash", { command: "ls" })].join("\n"))).toBeUndefined();
    expect(pendingClaudeDialog([user("go"), call("a", "AskUserQuestion", { questions: [{ question: "?" }] })].join("\n"))).toBeUndefined();
    expect(pendingClaudeDialog([user("go"), call("p", "ExitPlanMode", {})].join("\n"))).toBeUndefined();
  });
});

describe("Claude's dialogs read with the pending call", () => {
  const tabs = "←  ☒ Route  ☐ Author  ✔ Submit  →";
  const author = [tabs, "Who should author the commits?", "  1. Keep local", "❯ 2. Repo owner", "  3. Type something.", "────────────────────────────", "  4. Chat about this", "Enter to select · Tab/Arrow keys to navigate · Esc to cancel"].join("\n");

  test("names the question by the call, and answers from the cursor on screen", () => {
    const prompt = parseInteractivePrompt("claude", author, null, true, ask(ROUTE, AUTHOR));
    expect(prompt).toMatchObject({ kind: "question", title: "Author · 2 of 2", question: AUTHOR.question, custom_option_index: 2 });
    expect(answerKeys(prompt!, { option_index: 0 })).toEqual([{ keys: ["up"] }, { keys: ["enter"] }]);
    expect(answerKeys(prompt!, { custom_text: "the bot" })).toEqual([{ keys: ["down"] }, { text: "the bot" }, { keys: ["enter"] }]);
  });

  test("tells two questions with the same options apart by the question on screen, or gives no card", () => {
    const yes = { header: "Push", question: "Push the branch?", multiSelect: false, options: [{ label: "Yes", description: null }, { label: "No", description: null }] };
    const no = { ...yes, header: "Tag", question: "Tag the release?" };
    const rows = ["❯ 1. Yes", "  2. No", "  3. Type something.", "────────────", "  4. Chat about this", "Enter to select · Tab/Arrow keys to navigate · Esc to cancel"];
    expect(parseInteractivePrompt("claude", ["←  ☒ Push  ☐ Tag  ✔ Submit  →", "Tag the release?", ...rows].join("\n"), null, true, ask(yes, no))).toMatchObject({ title: "Tag · 2 of 2" });
    // cut off above the rows, either question could be the one shown
    expect(parseInteractivePrompt("claude", rows.slice(1).join("\n").replace("  2. No", "❯ 2. No"), null, true, ask(yes, no))).toBeNull();
  });

  test("gives no card for tabs that are not the call's, a missing cursor, or a multiple choice cut off", () => {
    expect(parseInteractivePrompt("claude", author.replace("☒ Route", "☒ Branch"), null, true, ask(ROUTE, AUTHOR))).toBeNull();
    expect(parseInteractivePrompt("claude", author.replace("❯ 2.", "  2."), null, true, ask(ROUTE, AUTHOR))).toBeNull();
    const sets = { header: "Sets", question: "Which datasets?", multiSelect: true, options: [{ label: "LM-O", description: null }, { label: "YCB-V", description: null }] };
    const rows = ["❯ 1. [ ] LM-O", "  2. [x] YCB-V", "  3. [ ] Type something", "     Submit", "────────────", "  4. Chat about this", "Enter to select · ↑/↓ to navigate · Esc to cancel"];
    const whole = parseInteractivePrompt("claude", ["←  ☐ Sets  ✔ Submit  →", "Which datasets?", ...rows].join("\n"), null, true, ask(sets));
    expect(whole).toMatchObject({ title: "Sets", multi_select: true, custom_option_index: null });
    // the second is checked already: only the first is toggled, then → moves on
    expect(answerKeys(whole!, { option_indices: [0, 1] })).toEqual([{ keys: ["enter"] }, { keys: ["right"] }]);
    expect(parseInteractivePrompt("claude", rows.slice(1).join("\n").replace("  2. [x]", "❯ 2. [x]"), null, true, ask(sets))).toBeNull();
    // a single choice asked, a multiple choice shown
    expect(parseInteractivePrompt("claude", ["Which datasets?", ...rows].join("\n"), null, true, ask({ ...sets, multiSelect: false }))).toBeNull();
  });

  test("reviews the answers under tabs out of view, and never for an answered or another call", () => {
    const review = [" ● Who should author the commits?", "   → Repo owner", "Ready to submit your answers?", "❯ 1. Submit answers", "  2. Cancel"].join("\n");
    expect(parseInteractivePrompt("claude", review)).toBeNull();
    const prompt = parseInteractivePrompt("claude", review, null, true, ask(ROUTE, AUTHOR));
    expect(prompt).toMatchObject({ kind: "menu", title: "Review your answers", question: "Ready to submit your answers?" });
    expect(prompt?.body).toContain("→ Repo owner");
    const whole = "←  ☒ Route  ☒ Author  ✔ Submit  →\nReview your answers\n" + review;
    expect(parseInteractivePrompt("claude", whole, null, true, ask(ROUTE, AUTHOR))).not.toBeNull();
    expect(parseInteractivePrompt("claude", whole, null, true, ask(ROUTE))).toBeNull();
    expect(parseInteractivePrompt("claude", whole, null, true, null)).toBeNull();
    expect(parseInteractivePrompt("claude", whole, null, true, { kind: "plan", plan: "x" })).toBeNull();
  });

  test("shows the call's whole plan over the approval the screen shows, in a pane that wraps its question", () => {
    const plan = "# Add a README\n\n1. Create README.md\n2. Add a heading\n3. Commit";
    const screen = ["3. Commit", "", "Claude has written up a", "plan and is ready to", "execute. Would you like", "to proceed?", "", "❯ 1. Yes, auto-accept edits", "  2. Yes, manually approve edits", "  3. Tell Claude what to change", "     shift+tab to approve with this feedback"].join("\n");
    expect(parseInteractivePrompt("claude", screen)).toBeNull();
    const prompt = parseInteractivePrompt("claude", screen, null, true, { kind: "plan", plan });
    expect(prompt).toMatchObject({ kind: "plan", title: "Ready to code?", body: plan, custom_option_index: 2, question: "Claude has written up a plan and is ready to execute. Would you like to proceed?" });
    expect(answerKeys(prompt!, { option_index: 1 })).toEqual([{ keys: ["down"] }, { keys: ["enter"] }]);
    expect(parseInteractivePrompt("claude", screen, null, true, null)).toBeNull();
    expect(parseInteractivePrompt("claude", screen, null, true, ask(ROUTE))).toBeNull();
    expect(parseInteractivePrompt("claude", screen + "\n\n● Done.\n", null, true, { kind: "plan", plan })).toBeNull();
  });

  test("leaves tool approvals and unnumbered menus to the screen, whatever the transcript says", () => {
    const approval = "────────────────────────────────────────\n Bash command\n   rm -rf junk\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel · Tab to amend\n";
    for (const dialog of [undefined, null, ask(ROUTE)]) expect(parseInteractivePrompt("claude", approval, null, true, dialog)).toMatchObject({ kind: "approval", title: "Bash command" });
  });
});
