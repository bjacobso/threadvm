import { Schema as S } from "effect";

export const ThemePreference = S.Literals(["light", "dark", "device"]);
export type ThemePreference = typeof ThemePreference.Type;

export const THEME_STORAGE_KEY = "threadvm.theme";
export const DEVICE_THEME_QUERY = "(prefers-color-scheme: dark)";

export const readThemePreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // The selector still works when browser storage is unavailable.
  }
  return "device";
};

export const applyTheme = (preference: ThemePreference): void => {
  const dark = preference === "dark" ||
    (preference === "device" && window.matchMedia(DEVICE_THEME_QUERY).matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  document.documentElement.classList.toggle("dark", dark);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Keep applying the choice even when it cannot be saved.
  }
};
