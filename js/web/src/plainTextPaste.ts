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
export function pasteAsPlainText(e: ClipboardEvent): void {
  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain") ?? "";
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  // Replace any selected text, matching native paste-over-selection.
  range.deleteContents();
  if (!text) return;
  const node = document.createTextNode(text);
  range.insertNode(node);
  // Drop the caret after the inserted run so typing continues from the
  // paste point rather than before it. We don't normalize() adjacent text
  // nodes: collapse re-renders plain text and re-linkifies from scratch,
  // so any fragmented tree is discarded before the next caret-offset walk.
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}
