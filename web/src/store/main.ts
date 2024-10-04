import { IDBPDatabase, openDB, deleteDB } from "idb";
import { ItemStore } from "./item-store";
import { ContainerStore } from "./container";
import { genTestData, sunlistItems, inboxItems } from "./dummy-data";
import { v, compile } from "suretype";
import { createUniqueId } from "solid-js";
import { DndContext, ListStateContext, TreeState } from "@sunlist/list";
import { itemLoader } from "./item";
import { DataView, ViewState } from "../view/state";
import { HistoricalItems } from "./historical";

const schemaVersion = 1;

interface DBTypes {
  items: Sunlist;
  lists: SunlistContainer;
}

export type SunlistIDB = IDBPDatabase<DBTypes>;
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
export class SunlistSession {
  userId: string = "anonymous";
  map = new Map<string, SunlistWorkspace>();
  workspace = new SunlistWorkspace(this);
  viewState = new ViewState(this.workspace);
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
        console.log("Invalid workspace object found in cache");
      }
    }
    if (parsed && compile(workspaceCache, { simple: true })(parsed)) {
      console.log("found existing workspaces");
      parsed.workspaces?.forEach((workspace) => {
        this.map.set(workspace.id, new SunlistWorkspace(this, workspace));
      });
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
      console.log("creating new workspace object");
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
      // new workspace
      if (!this.workspace.initialised) {
        this.workspace.name = "Private";
      }
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
export class SunlistWorkspace {
  db: SunlistIDB | null = null;
  itemStore = new ItemStore();
  containerStore = new ContainerStore(this);
  id: string = createUniqueId();
  name: string = "Uninitialised";
  initialised = false;
  localOnly: boolean = true;
  openLists = new Map<string, TreeState>();
  listStateContext = new ListStateContext();
  dndContext = new DndContext({ enableKeyboard: false });
  historical: HistoricalItems;
  app: SunlistSession;
  get ref() {
    return `idb://${this.id}@${schemaVersion}`;
  }
  constructor(app: SunlistSession, workspace?: { id: string; name: string }) {
    this.app = app;
    if (workspace) {
      this.id = workspace.id;
      this.name = workspace.name;
    }
    this.historical = new HistoricalItems(this.itemStore, this);
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
        await self.itemStore.upgrade(db);
        await self.containerStore.upgrade(db);
        console.log("Completed upgrade");
        // const doneStore = db.createObjectStore(doneStoreName, {
        //     keyPath: 'id',
        // });
      },
    });
    this.containerStore.init(db);
    this.itemStore.init(db);
    console.debug(`Connected to ${this.ref}`);
    this.db = db;
    this.containerStore.load();
    this.historical.load();
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
      ...genTestData("work", sunlistItems),
      ...genTestData("inbox", inboxItems),
    ];
    await this.itemStore.insert(items);
    await this.containerStore.insert([
      {
        id: "inbox",
        name: "Inbox",
        icon: "task",
        sortKey: "a",
        type: "generic-list",
        default: true,
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
        name: "Sunlist list with more characters",
        icon: "red",
        sortKey: "c",
        type: "generic-list",
      },
    ]);
  };
  // Creates or loads new session-persistent state
  openList(view: DataView): TreeState {
    let identifier = null;
    let state = null;
    if (view.type === "data") {
      identifier = `c#${view.containerId}`;
      state = this.openLists.get(identifier);
      if (!state) {
        const state = this.listStateContext.createTree({
          loader: itemLoader(this),
        });
        const list = this.itemStore
          .getItemsByList(view.containerId)
          .then((items) => {
            state.load({ id: "root", children: items });
          });
        this.openLists.set(identifier, state);
        return state;
      }
    }
    if (!state) throw new Error("Cannot determine list from view");
    return state;
  }
}
