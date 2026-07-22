// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, getStoredTheme, themes } from "../../src/renderer/theme";

describe("visual themes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("provides the initialized theme catalog", () => {
    expect(themes.map((theme) => theme.id)).toEqual([
      "ink",
      "navy",
      "jade",
      "cinnabar",
      "gold",
      "violet",
    ]);
  });

  it("applies and persists a light theme", () => {
    applyTheme("jade");
    expect(document.documentElement.dataset.theme).toBe("jade");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(getStoredTheme()).toBe("jade");
  });

  it("uses dark native controls for dark themes", () => {
    applyTheme("gold");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(getStoredTheme()).toBe("gold");
  });

  it("migrates the previous glass theme to the new default palette", () => {
    window.localStorage.setItem("duoduo.visual-theme", "mac-glass");
    expect(getStoredTheme()).toBe("ink");
  });

  it("falls back safely when stored data is invalid", () => {
    window.localStorage.setItem("duoduo.visual-theme", "unknown");
    expect(getStoredTheme()).toBe("ink");
  });
});
