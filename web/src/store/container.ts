import { createSignal } from "solid-js";
import { SunlistIDB, SunlistWorkspace } from "./main";
import { DndContext, ListStateContext, TreeState } from "@sunlist/list";
import { containerLoader } from "./container-loader";

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
export class ContainerModel {
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
  init = async (db: SunlistIDB) => {
    this.sundb = db;
  };
  load = async () => {
    const items = await this.db.getAll(this.storeName);
    const defaultContainer = items.find((c) => c.default === true);
    this.insert(items, false);
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
  insert = async (
    data: SunlistContainer | SunlistContainer[],
    persist = true,
  ) => {
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
      // TODO: Centralise queue
      if (persist) {
        dbPromises.push(store.add(item));
      }
    });
    // TODO: Centralise queue
    Promise.all(dbPromises).catch((err) => console.log(err));
    const newOl = { children: src };
    // Calc sortKeys
    this.tree.load(newOl);
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
  getLists = async (): Promise<Sunlist[]> => {
    const items = await this.db.getAll(this.storeName);
    return items;
  };
}
