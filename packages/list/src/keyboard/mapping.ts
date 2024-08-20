import {
  moveUp,
  jumpToTop,
  selectFromOriginUp,
  jumpToBottom,
  selectFromOriginDown,
  moveDown,
  selectOriginToTop,
  selectOriginToBottom,
} from "./behaviour";
import { ShortcutFunction, encodeShortcut } from "./encoding";

export const defaultMapping = new Map<string, ShortcutFunction>([
  [encodeShortcut({ key: "ArrowUp" }), moveUp],
  [encodeShortcut({ key: "ArrowUp", metaKey: true }), jumpToTop],
  [encodeShortcut({ key: "ArrowUp", shiftKey: true }), selectFromOriginUp],
  [
    encodeShortcut({ key: "ArrowUp", metaKey: true, shiftKey: true }),
    selectOriginToTop,
  ],
  [encodeShortcut({ key: "ArrowDown" }), moveDown],
  [encodeShortcut({ key: "ArrowDown", metaKey: true }), jumpToBottom],
  [
    encodeShortcut({ key: "ArrowDown", metaKey: true, shiftKey: true }),
    selectOriginToBottom,
  ],
  [encodeShortcut({ key: "ArrowDown", shiftKey: true }), selectFromOriginDown],
]);

export const vimMapping = new Map<string, ShortcutFunction>([]);
