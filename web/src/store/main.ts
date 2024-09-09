import { IDBPDatabase, openDB, deleteDB } from "idb";
import { ItemModel } from "./item";
import { ContainerModel } from "./container";
import { genTestData, bordeItems, inboxItems } from "./dummy-data";
import { v, compile } from "suretype";
import { createUniqueId } from "solid-js";
import { DndContext, ListDragContext, ListStateContext } from "@borde/list";
import { loader } from "./loader";
import styles from "../item/item.module.css";

const schemaVersion = 1;

interface DBTypes {
  items: BordeItem;
  lists: BordeContainer;
}

export type BordeIDB = IDBPDatabase<DBTypes>;
export const dbNotReadyMessage =
  "DB not loaded, pre-load buffer not yet implemented";

// TODO: Retrieve these from model
const itemStoreName = "item";
const doneStoreName = "done";
const containerStoreName = "container";
// Remote Config store per browser (but could do local storage)

const workspaceCache = v.object({
  activeWorkspace: v.string(),
  workspaces: v.array(
    v.object({
      id: v.string().required(),
      name: v.string().required(),
    }),
  ),
});

/**
 * Session & workspace store
 */
export class SessionStore {
  userId: string = "anonymous";
  map = new Map<string, AcmeWorkspaceStore>();
  workspace = new AcmeWorkspaceStore();
  constructor() {
    window.session = this;
  }
  get cacheKey() {
    return `user_${this.userId}:cache`;
  }
  loadWorkspaceCache() {
    const raw = localStorage.getItem(this.cacheKey);
    let parsed;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.log("Invalid object found in cache");
      }
    }
    if (parsed && compile(workspaceCache, { simple: true })(parsed)) {
      parsed.workspaces?.forEach((workspace) =>
        this.map.set(workspace.id, new AcmeWorkspaceStore(workspace)),
      );
      if (parsed.activeWorkspace) {
        this.open(parsed.activeWorkspace);
      } else if (this.map.size > 1) {
        // Assign active workspace & load
        const firstEntry = this.map.entries().next();
        this.open(firstEntry.value[0]);
      } else {
        this.open(createUniqueId());
      }
    } else {
      this.open(createUniqueId());
    }
  }
  serialise() {
    // return console.log(Array.from(this.map.values()));
    // localStorage.setItem(
    //   this.cacheKey,
    //   JSON.stringify({
    //     activeWorkspace: this.workspace?.id,
    //     workspaces: Array.from(this.map.values()),
    //   }),
    // );
  }
  open(workspaceId: string) {
    // TODO: Separate open/new workspace
    const workspace = this.map.get(workspaceId);
    if (workspace) {
      this.workspace = workspace;
    } else {
      this.workspace = new AcmeWorkspaceStore({
        id: createUniqueId(),
        name: "Private",
      });
      this.map.set(this.workspace.id, this.workspace);
    }
    this.workspace.connect();
    this.serialise();
  }
  remove() {}
  clear() {
    this.map = new Map();
  }
}

// Primary local persistence layer for a workspace
// Handles one workspace concurrently
// Each workspace has a separate idb connection
export class AcmeWorkspaceStore {
  db: BordeIDB | null = null;
  itemModel = new ItemModel();
  containerModel = new ContainerModel();
  id: string = createUniqueId();
  name: string = "Uninitialised";
  localOnly: boolean = true;
  openLists = new Map<string, ListDragContext>();
  listStateContext = new ListStateContext();
  dndContext = new DndContext();
  get ref() {
    return `idb://${this.id}@${schemaVersion}`;
  }
  constructor(workspace?: { id: string; name: string }) {
    if (workspace) {
      this.id = workspace.id;
      this.name = workspace.name;
    }
  }
  /**
   * Creates connection to existing database, alters schema where version changes
   * TODO: Loading screen while db is not ready
   */
  connect = async () => {
    // TODO: Check if items etc exist
    console.debug(`Connecting to ${this.ref}`);
    const self = this;
    const db = await openDB<DBTypes>(this.id, schemaVersion, {
      // TODO: Get upgrades as static methods from classes
      async upgrade(db) {
        console.debug(`Running upgrade`);
        await self.itemModel.upgrade(db);
        await self.containerModel.upgrade(db);
        console.log("Completed upgrade");
        // const doneStore = db.createObjectStore(doneStoreName, {
        //     keyPath: 'id',
        // });
      },
    });
    this.containerModel.init(db);
    this.itemModel.init(db);
    console.debug(`Connected to ${this.ref}`);
    this.db = db;
    this.containerModel.load();
    return db;
  };
  /**
   * A dev only route to delete and refresh db
   */
  reset = async () => {
    console.log("Resetting database");
    await this.db?.close();
    await deleteDB(this.id).catch((err) => console.log(err));
    console.log("Deleted DB");
    this.openLists.clear();
    await this.connect();
  };
  dummyData = async () => {
    const items = [
      ...genTestData("borde", bordeItems),
      ...genTestData("inbox", inboxItems),
    ];
    await this.itemModel.insert(items);
    await this.containerModel.insert([
      {
        id: "inbox",
        name: "Inbox",
        icon: "task",
        sortKey: "a",
        type: "generic-list",
      },
      {
        id: "work",
        name: "Work",
        icon: "craft",
        sortKey: "b",
        type: "generic-list",
      },
      {
        id: "long",
        name: "a really really long named list",
        icon: "red",
        sortKey: "c",
        type: "generic-list",
      },
    ]);
  };
  // Creates or loads new in-memory list
  openList(view: BordeView): ListDragContext {
    let identifier = null;
    let ctx = null;
    if (view.type === "container") {
      identifier = `c#${view.containerId}`;
      ctx = this.openLists.get(identifier);
      if (!ctx) {
        const state = this.listStateContext.createTree({ loader });
        const ctx = new ListDragContext({
          treeState: state,
          dndContext: this.dndContext,
          itemHeight: 28,
          placeholderStyle: styles["placeholder"],
        });
        const list = this.itemModel
          .getItemsByList(view.containerId)
          .then((items) => {
            ctx.treeState.load({ id: "root", children: items });
          });
        this.openLists.set(identifier, ctx);
        return ctx;
      }
    }
    // if (view.type === "done") {
    //   identifier = "done";
    //   fastList = this.openLists.get(identifier);
    //   if (!fastList) {
    //     fastList = new DoneFL(this);
    //     this.openLists.set(identifier, fastList);
    //   }
    // }
    if (!ctx) throw new Error("Cannot determine list from view");
    return ctx;
  }
}
