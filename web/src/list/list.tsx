import { useContext } from "solid-js";
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
  return (
    <section
      classList={{
        [styles.list]: true,
        [styles.focus]: viewState.activePaneId() === props.view.id,
      }}
      onFocus={() => {
        viewState.setActivePaneId(props.view.id);
      }}
      onClick={() => {
        viewState.setActivePaneId(props.view.id);
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
          style={`display: flex; flex-direction: column; min-height: 0; max-height: 100%; flex-grow: 1;`}
          // classList={{ [styles["focus"]]: ctx.isFocused() }}
        >
          <Tree />
        </div>
      </SolidListContext.Provider>
    </section>
  );
}
