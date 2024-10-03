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
    this.store.queue.subscribe(this.onTransaction.bind(this));
  }
  onTransaction(trx) {
    if (trx.type === "done") {
      if (trx.item.tsCompleted === null) {
        const idSet = this.tree.getNodesByIds(new Set([trx.item.id]));
        if (idSet.size) this.tree.delete(idSet);
      } else {
        // this.tree.add (respect current sort order)
      }
    }
  }
  async load() {
    const itemsRaw = await this.store.loadCompletedItems();
    this.tree.load({ children: itemsRaw });
  }
}
