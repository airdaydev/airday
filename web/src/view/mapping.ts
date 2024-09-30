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
]);
