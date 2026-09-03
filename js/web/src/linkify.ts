import { parseInternalUrl } from "./url.ts";

// Shared helpers for the contenteditable editors (row quick-entry and the
// task dialog) that turn http(s) URLs into clickable anchors while keeping
// `el.textContent` the plain string that gets saved back to the model.

// http(s) URLs, greedy up to the first whitespace/angle/quote. Trailing
// punctuation that isn't part of the URL (.,;:!?)]}'") is trimmed off so a
// sentence like "see https://x.com." doesn't swallow the full stop.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const URL_TRAIL_RE = /[.,;:!?)\]}'"]+$/;

// A link to this app's own origin + path with a recognised `#item_` /
// `#list_` / view hash (`spec/urls.md`). Marked `data-internal` so a
// click applies the route in place instead of opening a tab; this is how
// one item refers to another.
const isInternal = (url: string): boolean => parseInternalUrl(url) !== null;

// Render `text` into `el`, replacing existing children, with URLs wrapped in
// <a target="_blank"> anchors. `el.textContent` still returns the plain
// string for save-back.
export function setLinkifiedText(el: HTMLElement, text: string): void {
  el.replaceChildren();
  if (!text) return;
  URL_RE.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    let url = match[0];
    const trail = url.match(URL_TRAIL_RE);
    if (trail) url = url.slice(0, url.length - trail[0].length);
    if (!url) continue;
    if (match.index > lastIndex) {
      el.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const a = document.createElement("a");
    a.href = url;
    if (isInternal(url)) {
      a.dataset.internal = "";
    } else {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    a.textContent = url;
    el.appendChild(a);
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

// Absolute character offset of the collapsed caret within `el`, or null when
// there is no selection inside el or it isn't collapsed. Used to detect
// "caret at start / end of field" for arrow-key navigation between editors.
export function collapsedCaretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

// Focus `el` and collapse the caret to the end of its content.
export function placeCaretAtEnd(el: HTMLElement): void {
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// Focus `el` and collapse the caret to the start of its content.
export function placeCaretAtStart(el: HTMLElement): void {
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

// A plain (no-modifier) click on a linkified anchor inside `el` opens it in a
// new tab, or, for one of the app's own item / list links, navigates the
// fragment in place (the workspace's popstate handler applies the route).
// Anchors inside contenteditable don't navigate by default — clicks
// place the caret — so we intercept them; modifier-clicks fall through to
// native behaviour so the user can still click into a link to edit it.
// Returns true if a link was opened.
export function openLinkOnClick(e: MouseEvent, el: HTMLElement | undefined): boolean {
  const link = (e.target as HTMLElement | null)?.closest("a");
  if (
    link instanceof HTMLAnchorElement &&
    el?.contains(link) &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  ) {
    e.preventDefault();
    if (link.dataset.internal !== undefined) {
      // Same-document fragment navigation: pushes a history entry and
      // fires popstate. A no-op when the hash is already current.
      location.hash = new URL(link.href).hash;
    } else {
      window.open(link.href, "_blank", "noopener,noreferrer");
    }
    return true;
  }
  return false;
}
