declare module "@primavera-ui/components/dnd" {
  export type Key = string | number;
  export type TxnId = string;

  export type DndOp<T = unknown> =
    | { type: "move"; keys: Key[]; beforeKey: Key | null }
    | { type: "insert"; items: T[]; beforeKey: Key | null }
    | { type: "remove"; keys: Key[] }
    | { type: "update"; key: Key; patch: unknown }
    | { type: "reset"; keys: Key[] };

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

  export function register(): void;
}

declare module "@primavera-ui/components/dnd/solid" {
  import type { JSX } from "solid-js";
  import type { Key, DndOp } from "@primavera-ui/components/dnd";
  export type { Key, DndOp };

  export interface DndProps<T> {
    items: T[];
    setItems?: (next: T[]) => void;
    onReorder?: (op: DndOp<T>) => void;
    getKey: (item: T) => Key;
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
