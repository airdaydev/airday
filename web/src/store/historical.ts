import { createSignal } from "solid-js";
import { ItemStore } from "./item";
import { GenericItem } from "./loader";
import { SunlistWorkspace } from "./main";

export class HistoricalItems {
  store: ItemStore;
  workspace: SunlistWorkspace;
  items = createSignal([]);
  constructor(store: ItemStore, workspace: SunlistWorkspace) {
    this.store = store;
    this.workspace = workspace;
  }
  async load() {
    const itemsRaw = await this.store.loadCompletedItems();
    const items = itemsRaw.map((item) => new GenericItem(item, this.workspace));
    this.items[1](items);
  }
}
