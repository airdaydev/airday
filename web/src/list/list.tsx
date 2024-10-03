import { createEffect, onCleanup, onMount, Show, useContext } from "solid-js";
import styles from "./list.module.css";
import itemStyles from "../item/item.module.css";
import { DataView } from "../view/state";
import { Tree, SolidListContext, ListDragContext } from "@sunlist/list";
import { sessionContext } from "../store/context.js";
import { ListHeader } from "./list-header";
import NullList from "./null-list";
import { ListColumnHeaders } from "./list-col-head";

interface ListProps {
  view: DataView;
}

export function List(props: ListProps) {
  const session = useContext(sessionContext);
  const state = session.workspace.openList(props.view);
  const ctx = new ListDragContext({
    treeState: state,
    dndContext: session.workspace.dndContext,
    itemHeight: 32,
    placeholderStyle: itemStyles["placeholder"],
  });
  const container = session.workspace.containerStore.tree.idMap.get(
    props.view.containerId,
  );

  onCleanup(() => {
    session.workspace.dndContext.listContexts.delete(ctx);
  });

  createEffect(() => {
    if (ctx.dndContext.focusContext[0]() === ctx) {
      session.viewState.setActivePane(props.view);
    }
  });
  onMount(() => {
    ctx.setFocus();
  });
  return (
    <>
      <Show when={container} fallback={<NullList view={props.view} />}>
        <section
          classList={{
            [styles.list]: true,
            [styles.focus]: session.viewState.activePane[0]() === props.view,
          }}
          onClick={() => {
            session.viewState.setActivePane(props.view);
          }}
        >
          <ListHeader
            tabId={props.tabId}
            container={container}
            view={props.view}
          />
          <SolidListContext.Provider value={ctx}>
            <div
              class={styles["tree-wrap"]}
              // classList={{ [styles["focus"]]: ctx.isFocused() }}
            >
              <Tree />
            </div>
          </SolidListContext.Provider>
        </section>
      </Show>
    </>
  );
}
