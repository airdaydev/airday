import { createSignal } from "solid-js";
import { AirDB, AirWorkspace } from "./main";
import {
  DndContext,
  TreeContext,
  ListStateContext,
  TreeState,
} from "@air-app/list";
import { containerLoader, ContainerNode } from "./container";

export const [containers, setContainers] = createSignal<AirContainer[]>([]);

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
  sundb: AirDB | null = null;
  listStateContext = new ListStateContext();
  dndContext = new DndContext({ enableKeyboard: false });
  tree: TreeState;
  workspace: AirWorkspace;
  constructor(workspace: AirWorkspace) {
    this.workspace = workspace;
    this.tree = this.listStateContext.createTree({ loader: containerLoader });
  }
  getNavDnd = () => {
    return this.dndContext.listContexts.values().next().value as TreeContext;
  };
  init = async (db: AirDB) => {
    this.sundb = db;
  };
  load = async () => {
    const items = await this.db.getAll(this.storeName);
    const defaultContainer = items.find((c) => c.default === true);
    this.tree.loadChildren(items);
    // TODO: Remove temporary default view logic in favour of layouts
    if (defaultContainer) {
      this.workspace.app.viewState.openDataView(defaultContainer.id);
    }
  };
  upgrade = (db: AirDB) => {
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
  insert = async (data: ContainerNode | ContainerNode[]) => {
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
      this.tree.insertItems(new Set([new ContainerNode(item)]), [
        null,
        this.tree.count(),
      ]);
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
  idb_insert = async (data: AirContainer | AirContainer[]) => {
    const tx = this.db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    const insert = async (item: AirContainer) => {
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
  getLists = async (): Promise<AirItem[]> => {
    const items = await this.db.getAll(this.storeName);
    return items;
  };
}
