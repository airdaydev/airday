import {
  AttributeSet,
  AttrType,
  invertSchema,
  SyncObject,
} from "./sync-object";

export const CONTAINER = 0;

export const ContainerFieldId = {
  CONTAINER_NAME: 256,
} as const;

export const CONTAINER_SCHEMA = {
  0: { name: "name", t: AttrType.string },
};

class ContainerAttributes extends AttributeSet<typeof CONTAINER_SCHEMA> {
  schema = CONTAINER_SCHEMA;
  invert = invertSchema(CONTAINER_SCHEMA);
}

export class AirdayContainer extends SyncObject<typeof CONTAINER_SCHEMA> {
  attributes = new ContainerAttributes();
  readonly objectType = CONTAINER;
}
