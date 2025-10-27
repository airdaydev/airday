import { Accessor, createSignal, Signal } from "solid-js";
import { LWWRegister } from "../crdt/lww";
import { SyncObject, RegisterMap, KeyMap, Change } from "./sync-object";
import { Uuidv4 } from "../common/uuid";

export const CONTAINER = 0;

export const ContainerFieldId = {
  CONTAINER_NAME: 256,
} as const;

export const CONTAINER_KEY_MAP = {
  name: 0,
} as const satisfies KeyMap;

export interface ContainerAttrs extends RegisterMap<typeof CONTAINER_KEY_MAP> {
  name?: LWWRegister<string>;
}

export class AirdayContainer {
  private syncObject: SyncObject;
  constructor(syncObject: SyncObject) {
    this.syncObject = syncObject;
  }
}
