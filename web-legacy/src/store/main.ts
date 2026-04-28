import { IDBPDatabase, openDB, deleteDB } from "idb";
import { ItemStore } from "./item-store";
import { ContainerStore } from "./container-store";
import { genTestData, airItems, taskItems } from "./dummy-data";
import { v, compile } from "suretype";
import { createUniqueId } from "solid-js";
import { DndContext, ListStateContext, TreeState } from "@airday/list";
import { ViewState } from "../view/state";
import { DataView } from "../view/views";
import { HistoricalItems } from "./historical";
import { List } from "./list";
import { UpNext } from "./up-next";

const schemaVersion = 1;

interface DBTypes {
  items: AirItems;
  lists: AirContainer;
}

export type AirDB = IDBPDatabase<DBTypes>;
export const dbNotReadyMessage =
  "DB not loaded, pre-load buffer not yet implemented";

const libraryCache = v.object({
  activeLibrary: v.string(),
  libraries: v.array(
    v.object({
      id: v.string().required(),
      name: v.string().required(),
    }),
  ),
});

/**
 * Session & Library store
 */
export class AirSession {
  userId: string = "anonymous";
  map = new Map<string, AirLibrary>();
  library = new AirLibrary(this);
  viewState = new ViewState(this.library);
  constructor() {
    window.session = this;
  }
  get cacheKey() {
    return `user_${this.userId}:cache`;
  }
  loadLibraryCache() {
    const raw = localStorage.getItem(this.cacheKey);
    let parsed;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.log("Invalid library object found in cache");
      }
    }
    if (parsed && compile(libraryCache, { simple: true })(parsed)) {
      console.log("found existing libraries");
      parsed.libraries?.forEach((library) => {
        this.map.set(library.id, new AirLibrary(this, library));
      });
      if (parsed.activeLibrary) {
        this.open(parsed.activeLibrary);
      } else if (this.map.size > 1) {
        // Assign active library & load
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
    //     activeLibrary: this.library?.id,
    //     libraries: Array.from(this.map.values()),
    //   }),
    // );
  }
  open(libraryId: string) {
    // TODO: Separate open/new library
    const library = this.map.get(libraryId);
    if (library) {
      this.library = library;
    } else {
      // new library
      if (!this.library.initialised) {
        this.library.name = "Private";
      }
      this.map.set(this.library.id, this.library);
    }
    this.library.connect();
    this.serialise();
  }
  remove() {}
  clear() {
    this.map = new Map();
  }
}

// Primary local persistence layer for a library
// Handles one library concurrently
// Each library has a separate idb connection
export class AirLibrary {
  db: AirDB | null = null;
  itemStore = new ItemStore();
  containerStore = new ContainerStore(this);
  id: string = createUniqueId();
  name: string = "Uninitialised";
  initialised = false;
  localOnly: boolean = true;
  openLists = new Map<string, List>();
  listStateContext = new ListStateContext();
  dndContext = new DndContext({ enableKeyboard: false });
  historical: HistoricalItems;
  upNext: UpNext;
  app: AirSession;
  get ref() {
    return `idb://${this.id}@${schemaVersion}`;
  }
  constructor(app: AirSession, library?: { id: string; name: string }) {
    this.app = app;
    if (library) {
      this.id = library.id;
      this.name = library.name;
    }
    this.historical = new HistoricalItems(this.itemStore, this);
    this.upNext = new UpNext(this.itemStore, this);
  }
  /**
   * Creates connection to existing database, alters schema where version changes
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
      ...genTestData("work", airItems),
      ...genTestData("inbox", taskItems),
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
        id: "yo",
        name: "Media",
        icon: "folder",
        sortKey: "z",
        type: "folder",
        children: [
          {
            id: "long",
            name: "An Air list with more characters",
            icon: "red",
            sortKey: "c",
            type: "generic-list",
          },
        ],
      },
      {
        id: "work",
        name: "Work",
        icon: "craft",
        sortKey: "b",
        type: "generic-list",
      },
    ]);
  };
  // Creates or loads new session-persistent state
  openList(view: DataView): List {
    let identifier = null;
    let list = null;
    if (view.type === "data") {
      identifier = `c#${view.containerId}`;
      list = this.openLists.get(identifier);
      if (!list) {
        const list = new List(view.containerId, this.itemStore, this);
        list.load();
        this.openLists.set(identifier, list);
        return list;
      }
    }
    if (!list) throw new Error("Cannot determine list from view");
    return list;
  }
}
