import {
    IDBPDatabase, IDBPTransaction, openDB, deleteDB, wrap, unwrap,
} from 'idb';
import { ItemModel } from './item';
import { ContainerModel } from './container';
import { genTestData, bordeItems, inboxItems } from './dummy-data';
import { openLists } from './fast-list';

const schemaVersion = 1;

interface DBTypes {
    items: BordeItem;
    lists: BordeContainer;
}

export type BordeIDB = IDBPDatabase<DBTypes>;
export const dbNotReadyMessage = 'DB not loaded, pre-load buffer not yet implemented';

// TODO: Retrieve these from model
const itemStoreName = 'item';
const doneStoreName = 'done';
const containerStoreName = 'container';
// Remote Config store per browser (but could do local storage)

// Primary local persistence layer
class AcmeLocalStore {
    db: BordeIDB | null = null;
    itemModel = new ItemModel();
    containerModel = new ContainerModel();
    name = 'acme';
    get ref () {
        return `idb://${this.name}@${schemaVersion}`;
    }
    /**
     * Creates connection to existing database, alters schema where version changes
     * TODO: Loading screen while db is not ready
     */
    connect = async () => {
        // TODO: Check if items etc exist
        console.debug(`Connecting to ${this.ref}`);
        const db = await openDB<DBTypes>(this.name, schemaVersion, {
            // TODO: Get upgrades as static methods from classes
            async upgrade(db) {
                console.debug(`Running upgrade`);
                await store.itemModel.upgrade(db);
                await store.containerModel.upgrade(db);
                console.log('Completed upgrade');
                // const doneStore = db.createObjectStore(doneStoreName, {
                //     keyPath: 'id',
                // });
            },
        });
        store.containerModel.init(db);
        store.itemModel.init(db);
        console.debug(`Connected to ${this.ref}`);
        this.db = db;
        return db;
    }
    /**
     * A dev only route to delete and refresh db
     */
    reset = async () => {
        console.log('Resetting database');
        await this.db?.close();
        await deleteDB(this.name)
            .catch((err) => console.log(err));
        console.log('Deleted DB');
        await this.connect();
        openLists.clear();
        const items = [
            ...genTestData('bordelist', bordeItems),
            ...genTestData('inbox', inboxItems),
          ]
          await store.itemModel.insert(items);
          await store.containerModel.insert([
            {
              id: 'inbox',
              name: 'Inbox',
              icon: 'inbox',
              sortKey: 'a',
            },
            {
              id: 'borde',
              name: 'Borde',
              icon: 'cutting-board',
              sortKey: 'b',
            },
            {
              id: 'work',
              name: 'a really really long named list',
              icon: 'notepads',
              sortKey: 'c',
            },
          ]);
    }
}

export const store = new AcmeLocalStore();
await store.connect();
await store.containerModel.load();
