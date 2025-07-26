import { encodeShortcut } from "@airday/keyboard";
import { ViewState } from "./state";
import { AirWorkspace } from "../store/main";

export type ShortcutFunction = (ctx: {
  viewState: ViewState;
  workspace: AirWorkspace;
}) => void;

export const defaultMapping = new Map<string, ShortcutFunction>([
  [
    encodeShortcut({ key: "ß", altKey: true }),
    (ctx) => {
      ctx.viewState.toggleSidebar();
    },
  ],
  [
    encodeShortcut({ key: "ƒ", altKey: true }),
    (ctx) => {
      if (ctx.viewState.scene[0]() === "default") {
        const item = ctx.workspace.dndContext
          .focusedContext()
          ?.selection[0]()
          .values()
          .next().value;
        if (item) ctx.viewState.focusItem(item);
        return;
      }
    },
  ],
  [
    encodeShortcut({ key: "∑", altKey: true }),
    (ctx) => {
      const view = ctx.viewState.activePane[0]();
      if (view) ctx.viewState.closeView(view);
    },
  ],
  [
    encodeShortcut({ key: "«", altKey: true }),
    (ctx) => {
      // split horizontally
      const view = ctx.viewState.activePane[0]();
      if (view) ctx.viewState.addViewRelative(view, view.id, "right");
    },
  ],
  [
    encodeShortcut({ key: "–", altKey: true }),
    (ctx) => {
      // split vertically
      const view = ctx.viewState.activePane[0]();
      if (view) ctx.viewState.addViewRelative(view, view.id, "down");
    },
  ],
  [
    encodeShortcut({ key: "˙", altKey: true }),
    (ctx) => {
      // jump left
      const view = ctx.viewState.activePane[0]()?.getSibling("left");
      if (view) ctx.viewState.setActivePane(view);
    },
  ],
  [
    encodeShortcut({ key: "¬", altKey: true }),
    (ctx) => {
      // jump left
      const view = ctx.viewState.activePane[0]()?.getSibling("right");
      if (view) ctx.viewState.setActivePane(view);
    },
  ],
  [
    encodeShortcut({ key: "Backspace" }),
    (ctx) => {
      const context = ctx.workspace.dndContext.focusedContext();
      context?.treeState.delete(context.selection[0]());
    },
  ],
]);
