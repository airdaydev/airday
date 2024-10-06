import { encodeShortcut } from "@sunlist/keyboard";
import { ViewState } from "./state";
import { SunlistWorkspace } from "../store/main";

export type ShortcutFunction = (ctx: {
  viewState: ViewState;
  workspace: SunlistWorkspace;
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
      // split vertically
      const view = ctx.viewState.activePane[0]();
      if (view)
        ctx.viewState.addViewRelative(view.containerId, view.id, "right");
    },
  ],
  [
    encodeShortcut({ key: "–", altKey: true }),
    (ctx) => {
      // split horizontally
      const view = ctx.viewState.activePane[0]();
      if (view)
        ctx.viewState.addViewRelative(view.containerId, view.id, "down");
    },
  ],
]);
