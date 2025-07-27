import { ItemStore } from "./item-store";
import { itemLoader } from "./item";
import { AirLibrary } from "./main";
import { TreeState } from "@airday/list";
import { Trx } from "./trx";

export class UpNext {
  store: ItemStore;
  library: AirLibrary;
  tree: TreeState;
  constructor(store: ItemStore, library: AirLibrary) {
    this.store = store;
    this.library = library;
    this.tree = new TreeState({ loader: itemLoader(library) });
    this.tree.context = this.library.listStateContext;
    this.store.queue.subscribe(this.onTransaction.bind(this));
  }
  onTransaction(trx: Trx) {
    // if (trx.type === "check") {
    //   const item = this.tree.idMap.get(trx.item.id);
    //   if (!item && trx.item.tsDone) {
    //     this.tree.insertNode(
    //       new GenericItem(trx.item, this.library),
    //       null,
    //       0,
    //     );
    //   }
    //   if (item && !trx.item.tsDone) {
    //     this.tree.delete(new Set([item]));
    //   }
    // }
  }
  async load() {
    // TODO: Get up next item list
    // const itemsRaw = await this.store.loadCompletedItems();
    // this.tree.loadChildren(itemsRaw);
  }
}
