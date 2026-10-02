import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { Machine } from "../../shared/machines.ts";

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

(globalThis as Record<string, unknown>)["window"] ??= {
  location: { search: "" },
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  matchMedia: () => ({ matches: false }),
};

type Store = typeof import("./appStore.ts");
type Selectors = typeof import("./selectors.ts");
type Selection = typeof import("./selection.ts");
type Machines = typeof import("./machines.ts");

let store: Store;
let selectors: Selectors;
let selection: Selection;
let machines: Machines;

beforeAll(async () => {
  store = await import("./appStore.ts");
  selectors = await import("./selectors.ts");
  selection = await import("./selection.ts");
  machines = await import("./machines.ts");
});

function machine(id: string, paneIds: string[]): Machine {
  return {
    id,
    name: id.toUpperCase(),
    kind: "local",
    enabled: true,
    state: "connected",
    error: null,
    snapshot: {
      focused_pane_id: paneIds[0] ?? null,
      agents: [],
      workspaces: [{ workspace_id: "w1", label: "main" }],
      panes: paneIds.map((pane_id) => ({ pane_id, workspace_id: "w1", agent_status: "idle" })),
    },
  } as unknown as Machine;
}

beforeEach(() => {
  store.setApp({ machines: [machine("local", ["p1", "p2"]), machine("box", ["q1"])], selectedMachineId: "local", selectedPaneId: "p1", connected: true, outputStopped: true, drawerOpen: true });
});

describe("selectors", () => {
  test("return the same reference on repeated calls so subscribers do not loop", () => {
    const state = store.getApp();
    for (const select of [selectors.selectSelectedMachine, selectors.selectSnapshot, selectors.selectSelectedPane, selectors.selectSelectedWorkspace, selectors.selectTargetHerdr]) {
      expect(select(state)).toBe(select(store.getApp()));
    }
  });

  test("find the selected pane and its workspace", () => {
    expect(selectors.selectSelectedPane(store.getApp())?.pane_id).toBe("p1");
    expect(selectors.selectSelectedWorkspace(store.getApp())?.label).toBe("main");
  });
});

describe("selection", () => {
  test("a pane on the same machine keeps the live connection", () => {
    selection.selectTarget("local", "p2");
    const state = store.getApp();
    expect(state.connected).toBe(true);
    expect(state.outputStopped).toBe(false);
    expect(state.drawerOpen).toBe(false);
  });

  test("another machine resets the connection until its socket reports", () => {
    selection.selectTarget("box", "q1");
    expect(store.getApp().connected).toBe(false);
    expect(store.getApp().selectedMachineId).toBe("box");
  });

  test("adjacent pane wraps around", () => {
    selection.selectAdjacentPane(-1);
    expect(store.getApp().selectedPaneId).toBe("p2");
    selection.selectAdjacentPane(1);
    expect(store.getApp().selectedPaneId).toBe("p1");
  });

  test("toggleView flips the lens", () => {
    store.setApp({ view: "terminal" });
    selection.toggleView();
    expect(store.getApp().view).toBe("chat");
  });
});

describe("machines", () => {
  test("an equal roster keeps the previous reference", () => {
    const before = store.getApp().machines;
    machines.receiveMachines(structuredClone(before));
    expect(store.getApp().machines).toBe(before);
  });

  test("an unchanged pane status keeps the previous reference", () => {
    const before = store.getApp().machines;
    machines.applyMachinePaneStatus("local", "p1", "idle");
    expect(store.getApp().machines).toBe(before);
  });

  test("a changed pane status replaces only its machine", () => {
    const before = store.getApp().machines;
    machines.applyMachinePaneStatus("local", "p1", "working");
    const after = store.getApp().machines;
    expect(after).not.toBe(before);
    expect(after[1]).toBe(before[1]);
    expect(selectors.selectSelectedPane(store.getApp())?.agent_status).toBe("working");
  });
});
