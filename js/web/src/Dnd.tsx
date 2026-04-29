// Solid wrapper around <primavera-dnd>. The lib is a custom element
// driven by setSource()/setRenderer(); this component plumbs Solid's
// `render()` (which returns a dispose fn) into the renderer's mount
// contract. Children take *only* the key — the row reads its own data
// reactively from the store, so edits and status flips re-render
// without touching the source.

import { createEffect, onCleanup, onMount, type JSX } from "solid-js";
import { render } from "solid-js/web";
import {
  register,
  type DndOp,
  type DndSource,
  type Key,
  type TxnId,
} from "@primavera-ui/components/dnd";

register();

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "primavera-dnd": JSX.HTMLAttributes<HTMLElement>;
    }
  }
}

interface DndElement extends HTMLElement {
  setSource(s: DndSource<unknown>): void;
  setRenderer(r: { mount: (key: Key, item: unknown, c: HTMLElement) => () => void }): void;
}

export function Dnd<T>(props: {
  source: DndSource<T>;
  itemHeight?: number;
  onChange?: (op: DndOp<T>, txnId: TxnId) => void;
  children: (key: Key) => JSX.Element;
}) {
  let el!: DndElement;
  let unsubChange: (() => void) | null = null;

  onMount(() => {
    // Set attributes via setAttribute — primavera-dnd reads `item-height`
    // through a getter only, so JSX attribute->property assignment
    // (Solid's default for custom elements) throws.
    el.setAttribute("item-height", String(props.itemHeight ?? 40));
    el.setRenderer({
      mount: (key, _item, container) => {
        const dispose = render(() => props.children(key), container);
        return dispose;
      },
    });
  });

  // Track source changes (e.g. on view switch) and rewire the element.
  createEffect(() => {
    const src = props.source;
    el.setSource(src as DndSource<unknown>);
    if (unsubChange) unsubChange();
    unsubChange = props.onChange
      ? src.onChange(props.onChange as (op: DndOp<unknown>, t: TxnId) => void)
      : null;
  });
  onCleanup(() => {
    if (unsubChange) unsubChange();
  });
  return (
    <primavera-dnd
      ref={el}
      style={{ height: "100%", display: "block" }}
    />
  );
}
