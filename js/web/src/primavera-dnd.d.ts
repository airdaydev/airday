declare module "@primavera-ui/components/dnd" {
  export type Key = string | number;
  export type TxnId = number;

  export type DndOp<T> =
    | { type: "move"; keys: Key[]; beforeKey?: Key | null }
    | { type: "reset"; keys: Key[] };

  export interface DndSourceOpts<T> {
    getKey: (item: T) => Key;
    getOrder: () => Key[];
    getItem: (key: Key) => T;
  }

  export class DndSource<T> {
    constructor(opts: DndSourceOpts<T>);
    apply(ops: DndOp<T>[]): TxnId;
    _commitState(txnId: TxnId): void;
    onChange(listener: (op: DndOp<T>, txnId: TxnId) => void): () => void;
  }

  export function register(): void;
}
