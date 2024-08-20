import {
  jumpToTop,
  selectFromOriginUp,
  jumpToBottom,
  selectFromOriginDown,
  selectAboveOrigin,
  selectBelowOrigin,
  selectOriginToTop,
  selectOriginToBottom,
  selectAll,
  clearSelection,
  moveSelectionUp,
  moveSelectionDown,
} from "./behaviour";
import { ShortcutFunction, encodeShortcut } from "./encoding";

export const defaultMapping = new Map<string, ShortcutFunction>([
  [encodeShortcut({ key: "ArrowUp" }), selectAboveOrigin],
  [encodeShortcut({ key: "ArrowUp", metaKey: true }), jumpToTop],
  [encodeShortcut({ key: "ArrowUp", shiftKey: true }), selectFromOriginUp],
  [encodeShortcut({ key: "ArrowUp", altKey: true }), moveSelectionUp],
  [
    encodeShortcut({ key: "ArrowUp", metaKey: true, shiftKey: true }),
    selectOriginToTop,
  ],
  [encodeShortcut({ key: "ArrowDown" }), selectBelowOrigin],
  [encodeShortcut({ key: "ArrowDown", metaKey: true }), jumpToBottom],
  [
    encodeShortcut({ key: "ArrowDown", metaKey: true, shiftKey: true }),
    selectOriginToBottom,
  ],
  [encodeShortcut({ key: "ArrowDown", shiftKey: true }), selectFromOriginDown],
  [encodeShortcut({ key: "ArrowDown", altKey: true }), moveSelectionDown],
  [encodeShortcut({ key: "a", metaKey: true }), selectAll],
  [encodeShortcut({ key: "Escape" }), clearSelection],
]);

export const vimMapping = new Map<string, ShortcutFunction>([
  [encodeShortcut({ key: "k" }), selectAboveOrigin],
  [encodeShortcut({ key: "j" }), selectBelowOrigin],
  [encodeShortcut({ key: "G", shiftKey: true }), jumpToBottom],
  [encodeShortcut([{ key: "g" }, { key: "g" }]), jumpToTop],
]);
