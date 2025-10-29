// TODO: This should be a thin slice of code that sits with object definitions (e.g. item, container)
// and generated from Rust version (server/src/sync)
// Field ID constants matching server/src/sync_object/types.rs

import { AirdayContainer, CONTAINER } from "../airday/container";
import { AirdayItem, ITEM } from "../airday/item";
import { parseGenericSyncObject, SyncObject } from "./sync-object";

// Used for reading from IDB
function parseTypedSyncObject(json: any): AirdayItem | AirdayContainer {
  const genericObj = parseGenericSyncObject(json);
  const syncObject = new SyncObject({
    id: genericObj.id,
    objKind: genericObj.objKind,
    libraryId: genericObj.libraryId,
  });
  // Load attributes into the sync object
  if (genericObj.attributes) {
    syncObject.parseAttrSet(genericObj.attributes);
  }

  if (genericObj.objKind === ITEM) {
    return new AirdayItem(syncObject);
  }
  if (genericObj.objKind === CONTAINER) {
    return new AirdayContainer(syncObject);
  }
  // TODO: Handle error (or null return) upstream
  throw new Error("Type not found");
}
