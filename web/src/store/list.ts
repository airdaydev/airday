import { ItemStore } from "./item-store";
import { itemLoader } from "./item";
import { SunlistWorkspace } from "./main";
import { TreeState } from "@sunlist/list";
import { Trx } from "./trx";

export class List {
  store: ItemStore;
  workspace: SunlistWorkspace;
  tree: TreeState;
  id: string;
  constructor(id: string, store: ItemStore, workspace: SunlistWorkspace) {
    this.id = id;
    this.store = store;
    this.workspace = workspace;
    this.tree = new TreeState({ loader: itemLoader(workspace) });
    this.tree.context = this.workspace.listStateContext;
    this.store.queue.subscribe(this.onTransaction.bind(this));
  }
  onTransaction(trx: Trx) {
    if (trx.type === "check") {
      const item = this.tree.idMap.get(trx.item.id);
      if (item && trx.item.tsDone) {
        this.tree.delete(new Set([item]));
        // this.tree.insertNode(
        //   new GenericItem(trx.item, this.workspace),
        //   null,
        //   0,
        // );
      }
      // if (item && !trx.item.tsDone) {
      //   this.tree.delete(new Set([item]));
      // }
    }
  }
  async load() {
    const itemsRaw = await this.store.getItemsByList(this.id);
    this.tree.loadChildren(itemsRaw);
  }
}
