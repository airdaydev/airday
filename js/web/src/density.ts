// List density preference: "standard" (taller rows, hairline dividers)
// or "compact" (tighter rows, no dividers). A global appearance option,
// not per-list — the trade-off is between comfort and information
// density, and a user who wants one wants it everywhere.
//
// Stored in a cookie like the theme / hour-cycle prefs so it survives
// IndexedDB clears and needs no account. Applied as
// `<html data-density>` so CSS can restyle rows; the numeric row height
// the virtualizer needs is exposed via `rowHeight()`.

import { createSignal } from "solid-js";

export type ListDensity = "standard" | "compact";

const COOKIE_NAME = "density";
const MAX_AGE = 31536000; // 1 year

function readCookie(): ListDensity {
  try {
    if (/(?:^|; )density=compact(?:;|$)/.test(document.cookie)) return "compact";
  } catch {}
  return "standard";
}

function writeCookie(pref: ListDensity) {
  const attrs = (maxAge: number) => `path=/;max-age=${maxAge};SameSite=Lax`;
  if (pref === "standard") {
    document.cookie = `${COOKIE_NAME}=;${attrs(0)}`;
  } else {
    document.cookie = `${COOKIE_NAME}=${pref};${attrs(MAX_AGE)}`;
  }
}

function apply(pref: ListDensity) {
  document.documentElement.dataset.density = pref;
}

const [densityPref, setDensitySignal] = createSignal<ListDensity>(readCookie());
apply(densityPref());
export { densityPref };

export function setDensityPref(pref: ListDensity): void {
  setDensitySignal(pref);
  apply(pref);
  writeCookie(pref);
}

/** Fixed list-row height for the virtualizer. Must agree with the
 *  `.row` padding in styles.css: standard = 8px + 1.3em line + 8px,
 *  compact = 6px + line + 6px. Touch viewports add 12px for a
 *  comfortable thumb target. */
export function rowHeight(mobile: boolean): number {
  const base = densityPref() === "compact" ? 28 : 32;
  return mobile ? base + 12 : base;
}
