export const CONTAINER = 0;

export const ContainerFieldId = {
  CONTAINER_NAME: 256,
} as const;

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

// TODO: Complete item
export class AirdayContainer extends SyncObject {
  type: SyncObjectType = "container";
}
