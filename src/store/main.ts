import {
    IDBPDatabase, IDBPTransaction, openDB, deleteDB, wrap, unwrap,
} from 'idb';
import { ItemModel } from './item';
import { ContainerModel } from './container';

const schemaVersion = 1;

interface DBTypes {
    items: AcmeItem;
    lists: AcmeContainer;
}

export type AcmeIDB = IDBPDatabase<DBTypes>;
export const dbNotReadyMessage = 'DB not loaded, pre-load buffer not yet implemented';

// TODO: Retrieve these from model
const itemStoreName = 'item';
const doneStoreName = 'done';
const containerStoreName = 'container';
// Remote Config store per browser (but could do local storage)

// Primary local persistence layer
class AcmeLocalStore {
    db: AcmeIDB | null = null;
    itemModel = new ItemModel();
    containerModel = new ContainerModel();
    init = async () => {
        // TODO: Check if items etc exist
        const db = await openDB<DBTypes>('acme', schemaVersion, {
            // TODO: Get upgrades as static methods from classes
            upgrade(db) {
                const itemStore = db.createObjectStore(itemStoreName, {
                    keyPath: 'id',
                });
                const doneStore = db.createObjectStore(doneStoreName, {
                    keyPath: 'id',
                });
                db.createObjectStore(containerStoreName, {
                    keyPath: 'id',
                });
                itemStore.createIndex('listId', 'listId');
                itemStore.createIndex('ordered', ['listId', 'sortKey', 'id']);
                itemStore.createIndex('completed', ['listId', 'dateCompleted']);
            },
        });
        this.db = db;
        return db;
    }
    /**
     * A dev only route to delete and refresh db
     */
    refreshDev = async () => {
        const t = await deleteDB('acme');
        // this.init();
    }
}

export const store = new AcmeLocalStore();

await store.init()
    .then((db) => {
        store.itemModel.init(db);
        store.containerModel.init(db);
    });