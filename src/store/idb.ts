import {
    IDBPDatabase, IDBPTransaction, openDB, deleteDB, wrap, unwrap,
} from 'idb';

const schemaVersion = 1;

interface DBTypes {
    items: AcmeItem;
    lists: AcmeContainer;
}

export type AcmeIDB = IDBPDatabase<DBTypes>;