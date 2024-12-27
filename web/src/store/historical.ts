import { ItemStore } from "./item-store";
import { GenericItem, itemLoader } from "./item";
import { AirWorkspace } from "./main";
import { TreeState } from "@airday/list";
import { Trx } from "./trx";

export class HistoricalItems {
  store: ItemStore;
  workspace: AirWorkspace;
  tree: TreeState;
  constructor(store: ItemStore, workspace: AirWorkspace) {
    this.store = store;
    this.workspace = workspace;
    this.tree = new TreeState({ loader: itemLoader(workspace) });
    this.tree.context = this.workspace.listStateContext;
    this.store.queue.subscribe(this.onTransaction.bind(this));
  }
  onTransaction(trx: Trx) {
    if (trx.type === "check") {
      const item = this.tree.idMap.get(trx.item.id);
      if (!item && trx.item.tsDone) {
        this.tree.insertItems(
          new Set([new GenericItem(trx.item, this.workspace)]),
          [null, 0],
        );
      }
      if (item && !trx.item.tsDone) {
        this.tree.delete(new Set([item]));
      }
    }
  }
  async load() {
    const itemsRaw = await this.store.loadCompletedItems();
    this.tree.loadChildren(itemsRaw);
  }
}
