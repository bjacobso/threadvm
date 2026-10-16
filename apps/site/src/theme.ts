const STORAGE_KEY = "threadvm.theme";
const preferences = ["light", "dark", "device"] as const;
type Preference = (typeof preferences)[number];

const readPreference = (): Preference => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Appearance still works when browser storage is unavailable.
  }
  return "device";
};

export const setupTheme = () => {
  const device = matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const button = document.querySelector<HTMLButtonElement>(
    "[data-theme-toggle]",
  );
  const label = button?.querySelector<HTMLElement>("[data-theme-label]");
  const frames = document.querySelectorAll<HTMLIFrameElement>("[data-frame]");
  let preference = readPreference();

  const syncFrame = (frame: HTMLIFrameElement) => {
    const frameRoot = frame.contentDocument?.documentElement;
    if (frameRoot) {
      frameRoot.dataset.mode = root.dataset.mode;
      frameRoot.classList.toggle("dark", root.dataset.mode === "dark");
    }
  };

  const apply = () => {
    const dark =
      preference === "dark" || (preference === "device" && device.matches);
    root.dataset.mode = dark ? "dark" : "light";
    root.dataset.themePreference = preference;
    const themeColor = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (themeColor) themeColor.content = dark ? "#09090b" : "#ffffff";
    const current = preference[0]!.toUpperCase() + preference.slice(1);
    const next =
      preferences[(preferences.indexOf(preference) + 1) % preferences.length]!;
    const description = `Theme: ${current}. Switch to ${next} theme`;
    if (button) {
      button.setAttribute("aria-label", description);
      button.title = description;
      button.hidden = false;
    }
    if (label) label.textContent = current;
    frames.forEach(syncFrame);
  };

  button?.addEventListener("click", () => {
    preference =
      preferences[(preferences.indexOf(preference) + 1) % preferences.length]!;
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Keep the choice for this page without persistence.
    }
    apply();
  });
  device.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      preference = readPreference();
      apply();
    }
  });
  frames.forEach((frame) =>
    frame.addEventListener("load", () => syncFrame(frame)),
  );
  apply();
};
