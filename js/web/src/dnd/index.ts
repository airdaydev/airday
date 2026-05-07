export type {
  Key,
  TxnId,
  DndOp,
  Block,
  Selection,
  DndSourceArgs,
  DndRenderer,
  DragContext,
  DndDragEventDetail,
} from "./core/types";

export { DndSource } from "./core/source";
export { DndSelection } from "./core/selection";
export { PrimaveraDnd } from "./vanilla/container";

import { PrimaveraDnd } from "./vanilla/container";

export function register() {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("primavera-dnd")) {
    customElements.define("primavera-dnd", PrimaveraDnd);
  }
}
