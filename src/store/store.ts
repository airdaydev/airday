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

const itemStoreName = 'item';
const listStoreName = 'list';
// Remote Config store per browser (but could do local storage)

// Primary local persistence layer
class AcmeLocalStore {
    db: AcmeIDB | null = null;
    init = async () => {
        await deleteDB('acme');
        const db = await openDB<DBTypes>('acme', schemaVersion, {
            upgrade(db) {
                const itemStore = db.createObjectStore(itemStoreName, {
                    keyPath: 'id',
                });
                db.createObjectStore(listStoreName, {
                    keyPath: 'id',
                });
                itemStore.createIndex('listId', 'listId');
                itemStore.createIndex('ordered', ['listId', 'sortKey', 'id']);
            },
        });
        this.db = db;
        return db;
    }
}

export const store = new AcmeLocalStore();
export const itemModel = new ItemModel();
export const containerModel = new ContainerModel();
await store.init()
    .then((db) => {
        itemModel.init(db);
        containerModel.init(db);
    });