import { createSignal, Signal } from "solid-js";
import { ViewNode } from "./views";

export class Workspace {
  children: Signal<ViewNode[]> = createSignal<ViewNode[]>([]);
  activeIndex: Signal<number> = createSignal(0);
  get activeNode() {
    return this.children[0]()[this.activeIndex[0]()];
  }
  addChild(view: ViewNode, index?: number) {
    this.children[1]((prev) => {
      const next = [...prev];
      if (index !== undefined) {
        next.splice(index, 0, view);
      } else {
        next.push(view);
      }
      return next;
    });
  }
  findNodeById(id: string): ViewNode | undefined {
    return this.children[0]().find((node) => {
      if (node.id === id) {
        return node;
      }
    });
  }
  findNodeIndexById(id: string): number | undefined {
    return this.children[0]().findIndex((node) => {
      if (node.id === id) {
        return node;
      }
    });
  }
  count() {
    return this.children[0]().length;
  }
  replaceChild = (view: ViewNode, index: number = 0) => {
    this.children[1]((prev) => {
      const next = [...prev];
      next[index] = view;
      return next;
    });
  };
  removeView = (view: ViewNode) => {
    this.children[1]((prev) => {
      const next = prev.filter((v) => v.id !== view.id);
      return next;
    });
  };
}
