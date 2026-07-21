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
      "cloud",
      "sand",
      "graphite",
      "midnight",
      "mac-glass",
    ]);
  });

  it("applies and persists a light theme", () => {
    applyTheme("mac-glass");
    expect(document.documentElement.dataset.theme).toBe("mac-glass");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(getStoredTheme()).toBe("mac-glass");
  });

  it("uses dark native controls for dark themes", () => {
    applyTheme("midnight");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(getStoredTheme()).toBe("midnight");
  });

  it("falls back safely when stored data is invalid", () => {
    window.localStorage.setItem("duoduo.visual-theme", "unknown");
    expect(getStoredTheme()).toBe("cloud");
  });
});
