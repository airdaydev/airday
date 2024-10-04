import { ItemStore } from "./item-store";
import { GenericItem, itemLoader } from "./item";
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
    this.store.queue.subscribe(this.onTransaction.bind(this));
  }
  onTransaction(trx) {
    if (trx.type === "check") {
      const item = this.tree.idMap.get(trx.item.id);
      if (!item) {
        this.tree.insertNode(
          new GenericItem(trx.item, this.workspace),
          null,
          0,
        );
      }
    }
    // if (node) {
    //   if (trx.item.tsCompleted === null) {
    //     this.tree.delete(new Set([node]));
    //   }
    // } else {
    //   // create node if tsCompleted is true
    //   if (trx.item.tsCompleted !== null) {
    //   }
    // }
  }
  async load() {
    const itemsRaw = await this.store.loadCompletedItems();
    this.tree.load({ children: itemsRaw });
  }
}
