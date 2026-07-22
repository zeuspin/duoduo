import inkIcon from "../../../../docs/观风-App默认图标与六套主题/theme-icons/01-ink.png";
import navyIcon from "../../../../docs/观风-App默认图标与六套主题/theme-icons/02-navy.png";
import jadeIcon from "../../../../docs/观风-App默认图标与六套主题/theme-icons/03-jade.png";
import cinnabarIcon from "../../../../docs/观风-App默认图标与六套主题/theme-icons/04-cinnabar.png";
import goldIcon from "../../../../docs/观风-App默认图标与六套主题/theme-icons/05-gold.png";
import violetIcon from "../../../../docs/观风-App默认图标与六套主题/theme-icons/06-violet.png";

export const themes = [
  { id: "ink", name: "宣纸墨", description: "墨黑与宣纸白，默认品牌主题", colors: ["#f3efe5", "#fffdf8b8", "#111111"], icon: inkIcon },
  { id: "navy", name: "观海蓝", description: "沉静海蓝与清透雾白", colors: ["#f2f5f3", "#ffffffb8", "#163a4a"], icon: navyIcon },
  { id: "jade", name: "松石青", description: "温润松石与青瓷层次", colors: ["#dce9e1", "#f4faf6b8", "#174c43"], icon: jadeIcon },
  { id: "cinnabar", name: "朱砂红", description: "克制朱砂与暖宣纸色", colors: ["#f3e8d5", "#fff9edb8", "#a52d27"], icon: cinnabarIcon },
  { id: "gold", name: "玄黑金", description: "玄黑深色与鎏金强调", colors: ["#171717", "#232323cc", "#d2aa5a"], icon: goldIcon },
  { id: "violet", name: "云雾紫", description: "柔和云雾与含蓄紫调", colors: ["#eeeaf2", "#faf8fcb8", "#4a315e"], icon: violetIcon },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

const themeStorageKey = "duoduo.visual-theme";
const legacyThemeMap: Record<string, ThemeId> = {
  cloud: "navy",
  sand: "cinnabar",
  graphite: "gold",
  midnight: "navy",
  "mac-glass": "ink",
};

export function getStoredTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    if (themes.some((theme) => theme.id === value)) return value as ThemeId;
    return (value && legacyThemeMap[value]) || "ink";
  } catch {
    return "ink";
  }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme =
    theme === "gold" ? "dark" : "light";
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // The selected theme still applies for this session when storage is unavailable.
  }
}
