// TODO: This should be a thin slice of code that sits with object definitions (e.g. item, container)
// and generated from Rust version (server/src/sync_engine)
// Field ID constants matching server/src/sync_object/types.rs

import { AirdayContainer } from "./container";
import { AirdayItem } from "./item";

// Used for reading from IDB
function syncObjectFromJSON(json: any): AirdayItem | AirdayContainer {
  ensureSerialisedSyncObject(json); // TODO: First check if syncobject is good, then do attributes
  let syncObject = json as SerialisedSyncObject;
  const meta = {
    id: Uuidv4.fromHex(syncObject.id),
    libraryId: Uuidv4.fromHex(syncObject.libraryId),
    lastSync: syncObject.lastSync as bigint,
    lastModified: syncObject.lastModified as bigint,
  };
  if (syncObject.type === "item") {
    const attributes: AirdayItemAttributes = {};
    if (syncObject.attributes.text) {
      attributes.text = LWWRegister.fromJSON(syncObject.attributes.text);
    }
    return new AirdayItem({
      ...meta,
      attributes,
    });
  }
  if (syncObject.type === "container") {
    const attributes = {}; // TODO: Get specific attributes for container
    return new AirdayContainer({
      ...meta,
      // attributes,
    });
  }
  // TODO: Handle error (or null return) upstream
  throw new Error("Type not found");
}
