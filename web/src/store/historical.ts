import { ItemStore } from "./item";
import { itemLoader } from "./loader";
import { SunlistWorkspace } from "./main";
import { TreeState } from "@sunlist/list";

export class HistoricalItems {
  store: ItemStore;
  workspace: SunlistWorkspace;
  tree: TreeState;
  constructor(store: ItemStore, workspace: SunlistWorkspace) {
    this.store = store;
    this.workspace = workspace;
    this.tree = new TreeState({ loader: itemLoader(workspace) });
    this.tree.context = this.workspace.listStateContext;
  }
  async load() {
    const itemsRaw = await this.store.loadCompletedItems();
    this.tree.load({ children: itemsRaw });
    console.log("lesgo", this.tree.childrenSignal[0]());
  }
}
