import { describe, expect, it } from "bun:test";

import { clampSidebarWidth, readSidebarWidth, saveSidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_WIDTH_KEY } from "./sidebarWidth.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("sidebar width", () => {
  it("keeps a dragged width between the minimum and the default", () => {
    expect(clampSidebarWidth(100, 320)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(500, 320)).toBe(320);
    expect(clampSidebarWidth(280.6, 320)).toBe(281);
  });

  it("remembers a width and forgets it when reset", () => {
    const storage = memoryStorage();
    saveSidebarWidth(260, storage);
    expect(readSidebarWidth(storage)).toBe(260);
    saveSidebarWidth(null, storage);
    expect(storage.values.has(SIDEBAR_WIDTH_KEY)).toBe(false);
    expect(readSidebarWidth(storage)).toBeNull();
  });

  it("ignores a stored width that is missing, garbled or too narrow", () => {
    expect(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: "wide" }))).toBeNull();
    expect(readSidebarWidth(memoryStorage({ [SIDEBAR_WIDTH_KEY]: "120" }))).toBeNull();
  });

  it("answers the default when storage throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(readSidebarWidth(broken)).toBeNull();
    expect(() => saveSidebarWidth(300, broken)).not.toThrow();
  });
});
