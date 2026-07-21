export const themes = [
  { id: "cloud", name: "云杉浅色", description: "清晰、冷静的日间工作台", colors: ["#f3f6fb", "#ffffff", "#4775e6"] },
  { id: "sand", name: "暖砂浅色", description: "柔和、低疲劳的暖色界面", colors: ["#f6f2eb", "#fffdf9", "#a5633c"] },
  { id: "graphite", name: "石墨深色", description: "中性、专注的夜间界面", colors: ["#17191d", "#22252b", "#7da2f8"] },
  { id: "midnight", name: "午夜蓝", description: "深蓝层次与品牌强调色", colors: ["#0e1724", "#172334", "#6f9cff"] },
  { id: "mac-glass", name: "macOS 玻璃", description: "通透材质与原生桌面层次", colors: ["#dfe8f3", "#ffffffb8", "#3478f6"] },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

const themeStorageKey = "duoduo.visual-theme";

export function getStoredTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return themes.some((theme) => theme.id === value)
      ? (value as ThemeId)
      : "cloud";
  } catch {
    return "cloud";
  }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme =
    theme === "graphite" || theme === "midnight" ? "dark" : "light";
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}
