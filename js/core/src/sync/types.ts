// TODO: these should be generated from Rust version (server/src/sync_engine)
// Field ID constants matching server/src/sync_object/types.rs
export const ItemFieldId = {
  ITEM_TEXT: 0,
} as const;

export const ListFieldId = {
  LIST_NAME: 256,
} as const;

export const SyncObjectType = {
  ITEM: 0,
  CONTAINER: 1,
} as const;

enum AttributeType {
  "STRING",
  "BOOL",
  "INT",
  "BIGINT",
}

interface Attribute {
  fieldId: number;
  name: string;
  type: AttributeType;
}

class AttributeCodec {
  id: number;
  name: string;
  index = new Map<number, string>();
  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }
}

// export const itemModel = new AttributeCodec(SyncObjectType.ITEM, "item");
// itemModel.addAttributes([
//   {
//     fieldId: ItemFieldId.ITEM_TEXT,
//     name: "text",
//     type: AttributeType.STRING,
//   },
// ]);

// export const containerModel = new AttributeCodec(
//   SyncObjectType.CONTAINER,
//   "container",
// );
// containerModel.addAttributes([
//   {
//     fieldId: ListFieldId.LIST_NAME,
//     name: "name",
//     type: AttributeType.STRING,
//   },
// ]);
