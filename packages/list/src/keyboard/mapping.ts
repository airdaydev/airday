import {
  jumpToTop,
  selectFromOriginUp,
  jumpToBottom,
  selectFromOriginDown,
  selectRelativeToOrigin,
  selectOriginToTop,
  selectOriginToBottom,
  selectAll,
  clearSelection,
  moveSelectionUp,
  moveSelectionDown,
  expandNode,
  collapseNode,
} from "./behaviour";
import { ListDragContext } from "../dnd-context";
import { encodeShortcut } from "@sunlist/keyboard";

export type ShortcutFunction = (ctx: ListDragContext) => void;

export const defaultMapping = new Map<string, ShortcutFunction>([
  [encodeShortcut({ key: "ArrowUp" }), selectRelativeToOrigin("above")],
  [encodeShortcut({ key: "ArrowUp", metaKey: true }), jumpToTop],
  [encodeShortcut({ key: "ArrowUp", shiftKey: true }), selectFromOriginUp],
  [encodeShortcut({ key: "ArrowUp", altKey: true }), moveSelectionUp],
  [
    encodeShortcut({ key: "ArrowUp", metaKey: true, shiftKey: true }),
    selectOriginToTop,
  ],
  [encodeShortcut({ key: "ArrowDown" }), selectRelativeToOrigin("below")],
  [encodeShortcut({ key: "ArrowDown", metaKey: true }), jumpToBottom],
  [
    encodeShortcut({ key: "ArrowDown", metaKey: true, shiftKey: true }),
    selectOriginToBottom,
  ],
  [encodeShortcut({ key: "ArrowDown", shiftKey: true }), selectFromOriginDown],
  [encodeShortcut({ key: "ArrowDown", altKey: true }), moveSelectionDown],
  [encodeShortcut({ key: "ArrowLeft", altKey: true }), collapseNode],
  [encodeShortcut({ key: "ArrowRight", altKey: true }), expandNode],
  [encodeShortcut({ key: "a", metaKey: true }), selectAll],
  [encodeShortcut({ key: "Escape" }), clearSelection],
]);

export const vimMapping = new Map<string, ShortcutFunction>([
  [encodeShortcut({ key: "k" }), selectRelativeToOrigin("above")],
  [encodeShortcut({ key: "j" }), selectRelativeToOrigin("below")],
  [encodeShortcut({ key: "G", shiftKey: true }), jumpToBottom],
  [encodeShortcut([{ key: "g" }, { key: "g" }]), jumpToTop],
]);
