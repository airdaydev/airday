import { ListDragContext } from "../dnd-context";

export interface KeyboardShortcut {
  key: KeyboardEvent["key"];
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export function encodeShortcut(key: KeyboardShortcut | KeyboardEvent) {
  const modifiers =
    (key.metaKey ? 8 : 0) |
    (key.ctrlKey ? 4 : 0) |
    (key.altKey ? 2 : 0) |
    (key.shiftKey ? 1 : 0);
  return `${key.key}:${modifiers.toString(16)}`;
}

export type ShortcutFunction = (ctx: ListDragContext) => void;
