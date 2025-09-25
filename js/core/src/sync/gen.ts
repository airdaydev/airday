// TODO: This should be a thin slice of code that sits with object definitions (e.g. item, container)
// and generated from Rust version (server/src/sync)
// Field ID constants matching server/src/sync_object/types.rs

import { AirdayContainer, CONTAINER } from "./container";
import { AirdayItem, ITEM } from "./item";
import { parseGenericSyncObject } from "./sync-object";

// Used for reading from IDB
function parseTypedSyncObject(json: any): AirdayItem | AirdayContainer {
  const genericObj = parseGenericSyncObject(json);
  if (genericObj.objKind === ITEM) {
    // TODO: Type me
    const attributes: AirdayItemAttributes;
    return new AirdayItem({
      ...genericObj,
      attributes,
    });
  }
  if (genericObj.objKind === CONTAINER) {
    const attributes = {}; // TODO: Get specific attributes for container
    return new AirdayContainer({
      ...genericObj,
      attributes,
    });
  }
  // TODO: Handle error (or null return) upstream
  throw new Error("Type not found");
}
