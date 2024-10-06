import { createSignal } from "solid-js";
import { SunlistIDB, SunlistWorkspace } from "./main";
import {
  DndContext,
  ListDragContext,
  ListStateContext,
  TreeState,
} from "@sunlist/list";
import { containerLoader, GenericList } from "./container";

export const [containers, setContainers] = createSignal<SunlistContainer[]>([]);

// Structure:
// 1. signal(list of signal(items)) (sorted index)
// 2. Set(id, signal(items)) (hashed index of live item)
// TODO: Read https://github.com/solidjs/solid/discussions/749

/**
 * Container model i.e. data bucket e.g. a list
 * Provides fast in memory store, idb persistence layer & websocket interface
 * TODO: Put DB functions in a base class
 */
export class ContainerStore {
  storeName = "container";
  sundb: SunlistIDB | null = null;
  listStateContext = new ListStateContext();
  dndContext = new DndContext({ enableKeyboard: false });
  tree: TreeState;
  workspace: SunlistWorkspace;
  constructor(workspace: SunlistWorkspace) {
    this.workspace = workspace;
    this.tree = this.listStateContext.createTree({ loader: containerLoader });
  }
  getNavDnd = () => {
    return this.dndContext.listContexts.values().next()
      .value as ListDragContext;
  };
  init = async (db: SunlistIDB) => {
    this.sundb = db;
  };
  load = async () => {
    const items = await this.db.getAll(this.storeName);
    const defaultContainer = items.find((c) => c.default === true);
    this.tree.load({ id: "root", children: items });
    // TODO: Remove temporary default view logic in favour of layouts
    if (defaultContainer) {
      this.workspace.app.viewState.openDataView(defaultContainer.id);
    }
  };
  upgrade = (db: SunlistIDB) => {
    db.createObjectStore(this.storeName, {
      keyPath: "id",
    });
  };
  ready() {
    return !!this.db;
  }
  get db() {
    // TODO: This COULD be made redundant with proper queuing system
    if (!this.sundb) throw new Error("Item store uninitialised");
    return this.sundb;
  }
  insert = async (data: SunlistContainer | SunlistContainer[]) => {
    // Convert to array
    const src = Array.isArray(data) ? data : [data];
    // Store in database (TODO: Optimisation: Immediately store in mem)
    // Generalised queue for database storage, prevent browser from closing while persistence layer continues
    // User UI treats memory as source of truth, though insight into persistence layers available
    // Dependent updates are possible and should occur as DAG (e.g. list -> item)
    const dbPromises: Promise<any>[] = [];
    const tx = this.db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    // Create signals
    src.map((item, index) => {
      this.tree.insertNode(new GenericList(item), null, this.tree.count());
      return dbPromises.push(store.add(item));
    });
    Promise.all(dbPromises).catch((err) => console.log(err));
  };
  remove = async (id: string) => {
    if (!this.db) {
      throw new Error("Item store not initialised.");
    }
    const node = this.tree.idMap.get(id);
    if (node) {
      this.tree.delete(new Set([node]));
    }
    await this.db.delete(this.storeName, id);
  };
  idb_insert = async (data: SunlistContainer | SunlistContainer[]) => {
    const tx = this.db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    const insert = async (item: SunlistContainer) => {
      const prev = await store.get(item.id);
      if (prev) throw new Error("Key already exists");
      const val = await store.add(item);
      return val;
    };
    if (Array.isArray(data)) {
      await data.map((item) => insert(item));
    } else {
      insert(data);
    }
    await tx.done;
  };
  getLists = async (): Promise<SunlistItem[]> => {
    const items = await this.db.getAll(this.storeName);
    return items;
  };
}
