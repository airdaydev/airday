import { createEffect, useContext } from "solid-js";
import styles from "./list.module.css";
import itemStyles from "../item/item.module.css";
import { DataView, viewState } from "../view/state";
import { Tree, SolidListContext, ListDragContext } from "@borde/list";
import { sessionContext } from "../store/context.js";
import { ListHeader } from "./list-header";

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
  const container = session.workspace.containerModel.tree.idMap.get(
    props.view.containerId,
  );
  createEffect(() => {
    if (ctx.dndContext.focusContext[0]() === ctx) {
      viewState.activePaneId[1](props.view.id);
    }
  });
  return (
    <section
      classList={{
        [styles.list]: true,
        [styles.focus]: viewState.activePaneId[0]() === props.view.id,
      }}
      onClick={() => {
        viewState.activePaneId[1](props.view.id);
      }}
    >
      {container && (
        <ListHeader
          tabId={props.tabId}
          container={container}
          view={props.view}
        />
      )}
      <SolidListContext.Provider value={ctx}>
        <div
          class={styles["tree-wrap"]}
          // classList={{ [styles["focus"]]: ctx.isFocused() }}
        >
          <Tree />
        </div>
      </SolidListContext.Provider>
    </section>
  );
}
