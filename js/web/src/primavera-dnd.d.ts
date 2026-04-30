declare module "@primavera-ui/components/dnd" {
  export type Key = string | number;
  export type TxnId = string;

  export type DndOp<T = unknown> =
    | { type: "move"; keys: Key[]; beforeKey: Key | null }
    | { type: "insert"; items: T[]; beforeKey: Key | null }
    | { type: "remove"; keys: Key[] }
    | { type: "update"; key: Key; patch: unknown }
    | { type: "reset"; keys: Key[] };

  export interface Block {
    anchor: Key;
    to: Key;
  }

  export interface Selection {
    blocks: Block[];
    active: Block | null;
  }

  export interface DndSourceOpts<T> {
    getKey: (item: T) => Key;
    getOrder: () => readonly Key[];
    getItem: (key: Key) => T | undefined;
  }

  export class DndSource<T> {
    constructor(opts: DndSourceOpts<T>);
    apply(ops: DndOp<T>[]): TxnId;
    _commitState(txnId: TxnId): void;
    syncOrder(): void;
    onChange(listener: (op: DndOp<T>, txnId: TxnId) => void): () => void;
  }

  export class DndSelection {
    constructor(order?: readonly Key[]);
    onChange(cb: (sel: DndSelection) => void): () => void;
    updateOrder(order: readonly Key[]): void;
    getSelection(): Selection;
    isSelected(key: Key): boolean;
    getSelectedKeys(): Key[];
    hasSelection(): boolean;
    getActiveBlock(): Block | null;
    getSelectionTop(): Key | null;
    getSelectionBottom(): Key | null;
    selectOnly(item: Key): void;
    addBlock(item: Key): void;
    extendActive(item: Key): void;
    toggleItem(item: Key): void;
    moveSelection(dir: "up" | "down"): void;
    selectAll(): void;
    clear(): void;
    first(): Key;
    last(): Key;
    next(item: Key): Key;
    prev(item: Key): Key;
    activeTop(): Key | null;
    activeBottom(): Key | null;
  }

  export function register(): void;
}

declare module "@primavera-ui/components/dnd/solid" {
  import type { JSX } from "solid-js";
  import type { Key, DndOp, DndSelection } from "@primavera-ui/components/dnd";
  export type { Key, DndOp };
  export { DndSelection } from "@primavera-ui/components/dnd";

  export interface DndProps<T> {
    items: T[];
    setItems?: (next: T[]) => void;
    onReorder?: (op: DndOp<T>) => void;
    getKey: (item: T) => Key;
    selection?: DndSelection;
    itemHeight?: number;
    overscan?: number;
    confineAutoscroll?: boolean;
    autoscrollBuffer?: number;
    dragStackCount?: number;
    nudge?: boolean;
    roundedSelect?: boolean;
    autofocus?: boolean;
    dragType?: "native" | "overlay";
    class?: string;
    style?: JSX.CSSProperties | string;
    children: (item: () => T) => JSX.Element;
  }

  export function Dnd<T>(props: DndProps<T>): JSX.Element;
}
