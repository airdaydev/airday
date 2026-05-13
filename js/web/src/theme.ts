// Theme preference manager. Stores "auto" | "light" | "dark" in a
// cookie so the inline pre-render script in index.html can pick it up
// before Solid mounts (no FOUC). Single-origin cookie — airday's
// bundle is served from the API origin

export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const COOKIE_NAME = "theme";
const MAX_AGE = 31536000; // 1 year

function cookieAttrs(maxAge: number): string {
  return `path=/;max-age=${maxAge};SameSite=Lax`;
}

function readCookie(): ThemePreference {
  try {
    const m = document.cookie.match(/(?:^|; )theme=([01])/);
    if (m) return m[1] === "1" ? "dark" : "light";
  } catch {}
  return "auto";
}

function writeCookie(pref: ThemePreference) {
  if (pref === "auto") {
    document.cookie = `${COOKIE_NAME}=;${cookieAttrs(0)}`;
  } else {
    document.cookie = `${COOKIE_NAME}=${pref === "dark" ? "1" : "0"};${cookieAttrs(MAX_AGE)}`;
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return pref;
}

export function createTheme(opts?: {
  onApply?: (resolved: ResolvedTheme) => void;
}) {
  let current: ThemePreference = readCookie();

  function apply(pref: ThemePreference) {
    const resolved = resolveTheme(pref);
    document.documentElement.dataset.theme = resolved;
    opts?.onApply?.(resolved);
  }

  apply(current);

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (current === "auto") apply("auto");
  };
  mq.addEventListener("change", onChange);

  return {
    get: () => current,
    set(pref: ThemePreference) {
      current = pref;
      apply(pref);
      writeCookie(pref);
    },
    dispose() {
      mq.removeEventListener("change", onChange);
    },
  };
}
