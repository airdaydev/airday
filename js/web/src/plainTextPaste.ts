// Strip formatting when pasting into a contenteditable. By default a
// browser drops the clipboard's full HTML (bold, coloured spans, links,
// even images) into the editor. Our editors only ever save
// `el.textContent`, so that markup never reaches the model — but it sits
// in the DOM looking styled until the row collapses, a confusing mismatch
// between what you see while editing and what actually gets stored. This
// inserts the clipboard's plain text at the caret instead, so the editor
// shows exactly what will be saved. Newlines are preserved: the expanded
// editors use `white-space: pre-wrap` and the model stores multi-line
// text faithfully.
//
// Because the native paste is cancelled and the DOM is edited by hand, the
// browser fires no `input` event for it. Editors that mirror the DOM into a
// buffer on `input` (the task dialog's title and notes, whose notes buffer
// also streams deltas to the core) would otherwise never see the pasted
// text: it sat in the DOM but was never saved unless a keystroke followed.
// So a synthetic `input` is dispatched on the editor after the insertion.
export function pasteAsPlainText(e: ClipboardEvent): void {
  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain") ?? "";
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const editor = editorOf(e, range);
  // Replace any selected text, matching native paste-over-selection.
  const hadSelection = !range.collapsed;
  range.deleteContents();
  if (text) {
    const node = document.createTextNode(text);
    range.insertNode(node);
    // Drop the caret after the inserted run so typing continues from the
    // paste point rather than before it. We don't normalize() adjacent
    // text nodes: collapse re-renders plain text and re-linkifies from
    // scratch, so any fragmented tree is discarded before the next
    // caret-offset walk.
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else if (!hadSelection) {
    // Nothing on the clipboard and nothing removed: the DOM is unchanged.
    return;
  }
  editor?.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertFromPaste",
      data: text,
    }),
  );
}

// The contenteditable the paste landed in. `currentTarget` is the listener's
// element for both native and Solid-delegated handlers; fall back to the
// nearest editable ancestor of the caret for callers that forward the event.
function editorOf(e: ClipboardEvent, range: Range): HTMLElement | null {
  if (e.currentTarget instanceof HTMLElement) return e.currentTarget;
  const start = range.startContainer;
  const el = start instanceof Element ? start : start.parentElement;
  return el?.closest<HTMLElement>("[contenteditable]") ?? null;
}
