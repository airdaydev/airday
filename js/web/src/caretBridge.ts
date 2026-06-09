// Caret handoff between a contenteditable and a textarea that sit in the
// same row body. Down on the last visual line of the editable jumps into
// the textarea at the matching X; Up on the first visual line of the
// textarea jumps back into the editable at the matching X. The textarea
// has no Range API, so its caret rect is measured via a transient mirror
// div that copies the textarea's text-layout-affecting computed styles.

/** Returns the caret's viewport X if the caret in `editable` sits on the
 *  last visual line of its content, else null. Requires a collapsed
 *  selection inside `editable`. */
export function caretXIfOnLastLine(editable: HTMLElement): number | null {
  return editableCaretLineX(editable, "last");
}

/** Mirror of `caretXIfOnLastLine` for the first visual line. */
export function caretXIfOnFirstLine(editable: HTMLElement): number | null {
  return editableCaretLineX(editable, "first");
}

function editableCaretLineX(
  editable: HTMLElement,
  which: "first" | "last",
): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!editable.contains(range.startContainer)) return null;

  const caret = rangeCaretRect(range, editable);
  const probe = document.createRange();
  probe.selectNodeContents(editable);
  probe.collapse(which === "first");
  const probeRect = rangeCaretRect(probe, editable);

  const onLine =
    which === "first"
      ? Math.abs(caret.top - probeRect.top) < 1.5
      : Math.abs(caret.bottom - probeRect.bottom) < 1.5;
  return onLine ? caret.left : null;
}

// Range.getBoundingClientRect returns {0,0,0,0} for a collapsed range in
// an empty element on some browsers; fall back to the element's own box
// so empty-editable cases still produce a sensible X.
function rangeCaretRect(range: Range, editable: HTMLElement): DOMRect {
  const r = range.getBoundingClientRect();
  if (r.top === 0 && r.bottom === 0 && r.left === 0 && r.width === 0) {
    return editable.getBoundingClientRect();
  }
  return r;
}

/** Focus `textarea` and place its caret on the first visual line at the
 *  text offset whose X is closest to `viewportX`. */
export function focusTextareaFirstLineAtX(
  textarea: HTMLTextAreaElement,
  viewportX: number,
): void {
  textarea.focus({ preventScroll: false });
  const cs = getComputedStyle(textarea);
  const lineH = resolveLineHeight(cs);
  const padT = parseFloat(cs.paddingTop) || 0;
  const borderT = parseFloat(cs.borderTopWidth) || 0;
  const r = textarea.getBoundingClientRect();
  const y = r.top + borderT + padT + lineH / 2;
  const offset = textareaOffsetAtPoint(textarea, viewportX, y);
  textarea.setSelectionRange(offset, offset);
}

/** Focus `editable` and place its caret on the last visual line at the
 *  position whose X is closest to `viewportX`. */
export function focusEditableLastLineAtX(
  editable: HTMLElement,
  viewportX: number,
): void {
  editable.focus();
  const probe = document.createRange();
  probe.selectNodeContents(editable);
  probe.collapse(false);
  const probeRect = rangeCaretRect(probe, editable);
  const y =
    probeRect.height > 0
      ? probeRect.top + probeRect.height / 2
      : probeRect.bottom - 2;

  const pos = caretPositionFromPoint(viewportX, y);
  const range = document.createRange();
  if (pos && editable.contains(pos.offsetNode)) {
    range.setStart(pos.offsetNode, pos.offset);
  } else {
    range.selectNodeContents(editable);
    range.collapse(false);
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Returns the textarea caret's viewport X if it's on the first visual
 *  line of its value, else null. */
export function textareaCaretXIfOnFirstLine(
  textarea: HTMLTextAreaElement,
): number | null {
  return textareaCaretLineX(textarea, "first");
}

/** Mirror of `textareaCaretXIfOnFirstLine` for the last visual line. */
export function textareaCaretXIfOnLastLine(
  textarea: HTMLTextAreaElement,
): number | null {
  return textareaCaretLineX(textarea, "last");
}

function textareaCaretLineX(
  textarea: HTMLTextAreaElement,
  which: "first" | "last",
): number | null {
  const measurement = measureTextareaCaret(textarea);
  if (!measurement) return null;
  const { x, caretTop, endTop, lineH } = measurement;
  if (which === "first") {
    // First visual line ≡ caret top is within the first line slot.
    if (caretTop >= lineH - 1) return null;
  } else {
    if (Math.abs(caretTop - endTop) > 1.5) return null;
  }
  return x;
}

interface TextareaCaretMeasurement {
  /** Caret X in viewport coordinates. */
  x: number;
  /** Caret top relative to the textarea's content-box top. */
  caretTop: number;
  /** End-of-value marker top relative to the textarea's content-box top. */
  endTop: number;
  lineH: number;
}

// Builds a hidden div mirroring the textarea's text layout, reads the
// caret marker's bounding rect, then tears the mirror down. O(n) on the
// textarea value (one text-node split), runs once per relevant keydown.
function measureTextareaCaret(
  textarea: HTMLTextAreaElement,
): TextareaCaretMeasurement | null {
  const cs = getComputedStyle(textarea);
  const mirror = document.createElement("div");
  // Properties that affect wrapped-text layout. Borders intentionally
  // omitted so mirror.getBoundingClientRect() returns the padding-box
  // origin — easier to align with the textarea's content-box.
  const copyProps = [
    "boxSizing",
    "width",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "fontStretch",
    "letterSpacing",
    "lineHeight",
    "textAlign",
    "textIndent",
    "textTransform",
    "wordSpacing",
    "tabSize",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
  ] as const;
  for (const p of copyProps) {
    (mirror.style as any)[p] = (cs as any)[p];
  }
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  // The textarea reads as `border-box` width-wise but we stripped borders;
  // adjust width so the mirror's padding-box (and therefore content-box)
  // width matches the textarea's.
  if (cs.boxSizing === "border-box") {
    const borderL = parseFloat(cs.borderLeftWidth) || 0;
    const borderR = parseFloat(cs.borderRightWidth) || 0;
    const w = parseFloat(cs.width) || 0;
    mirror.style.boxSizing = "border-box";
    mirror.style.width = `${Math.max(0, w - borderL - borderR)}px`;
  }

  const value = textarea.value;
  const pos = textarea.selectionStart ?? 0;
  mirror.appendChild(document.createTextNode(value.substring(0, pos)));
  const marker = document.createElement("span");
  marker.textContent = "​"; // ZWSP — measurable, doesn't perturb layout
  mirror.appendChild(marker);
  // Trailing content needs to be present so wrapping after the caret
  // matches the textarea's wrapping.
  mirror.appendChild(document.createTextNode(value.substring(pos)));
  const endMarker = document.createElement("span");
  endMarker.textContent = "​";
  mirror.appendChild(endMarker);

  document.body.appendChild(mirror);
  try {
    const mirrorRect = mirror.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const endRect = endMarker.getBoundingClientRect();
    const taRect = textarea.getBoundingClientRect();
    const borderL = parseFloat(cs.borderLeftWidth) || 0;

    // Mirror has no border, so mirrorRect.left is its padding-box left.
    // markerRect.left - mirrorRect.left = caret offset from padding-box
    // origin, which equals the same offset in the textarea. Add the
    // textarea's content-box origin in viewport coords.
    const caretLeftInPad = markerRect.left - mirrorRect.left;
    const caretTopInPad = markerRect.top - mirrorRect.top;
    const endTopInPad = endRect.top - mirrorRect.top;
    return {
      x: taRect.left + borderL + caretLeftInPad,
      caretTop: caretTopInPad,
      endTop: endTopInPad,
      lineH: resolveLineHeight(cs),
    };
  } finally {
    mirror.remove();
  }
}

function textareaOffsetAtPoint(
  textarea: HTMLTextAreaElement,
  viewportX: number,
  viewportY: number,
): number {
  const pos = caretPositionFromPoint(viewportX, viewportY);
  if (pos && pos.offsetNode === textarea) return pos.offset;
  // Fallback: binary search via the mirror. Rarely triggered (only on
  // browsers that lack caretPositionFromPoint or return a shadow-tree
  // node for textareas).
  return mirrorOffsetAtX(textarea, viewportX);
}

function mirrorOffsetAtX(
  textarea: HTMLTextAreaElement,
  viewportX: number,
): number {
  const value = textarea.value;
  if (!value) return 0;
  // Linear scan is fine — landing positions for first/last line cap the
  // useful range to one visual line. Stop at the first newline (line wrap
  // edge for our purposes) to keep the cost bounded.
  const original = textarea.selectionStart;
  let best = 0;
  let bestDx = Infinity;
  for (let i = 0; i <= value.length; i++) {
    if (value[i] === "\n") break;
    textarea.setSelectionRange(i, i);
    const m = measureTextareaCaret(textarea);
    if (!m) continue;
    const dx = Math.abs(m.x - viewportX);
    if (dx < bestDx) {
      bestDx = dx;
      best = i;
    } else if (dx > bestDx + 4) {
      break; // moving away, give up
    }
  }
  textarea.setSelectionRange(original, original);
  return best;
}

function caretPositionFromPoint(
  x: number,
  y: number,
): { offsetNode: Node; offset: number } | null {
  // Standard API; widely supported in modern browsers.
  const doc = document as any;
  if (typeof doc.caretPositionFromPoint === "function") {
    return doc.caretPositionFromPoint(x, y);
  }
  // Legacy WebKit fallback. For non-textarea targets the returned Range
  // is fine; for textareas the caller skips this path and uses the
  // mirror-based offset search.
  if (typeof doc.caretRangeFromPoint === "function") {
    const r: Range | null = doc.caretRangeFromPoint(x, y);
    if (r) return { offsetNode: r.startContainer, offset: r.startOffset };
  }
  return null;
}

function resolveLineHeight(cs: CSSStyleDeclaration): number {
  const lh = parseFloat(cs.lineHeight);
  if (Number.isFinite(lh)) return lh;
  return (parseFloat(cs.fontSize) || 16) * 1.2;
}
