import { useContext } from "solid-js";
import styles from "./list.module.css";
import { viewState } from "../view-state";
import {
  Tree,
  DndContext,
  Dragged,
  ListDragContext,
  ListStateContext,
  SolidListContext,
} from "@borde/list";
import { sessionContext } from "../store/context.js";
import { ListHeader } from "./list-header";

interface ListProps {
  view: BordeView;
  tabId: number;
}

export function List(props: ListProps) {
  const session = useContext(sessionContext);
  const ctx = session.workspace.openList(props.view);
  const container = session.workspace.containerModel.index.get(
    props.view.containerId,
  );
  return (
    <section
      classList={{
        [styles.list]: true,
        [styles.active]: viewState.activeViewId() === props.view.id,
      }}
      tabIndex={props.tabId}
      onFocus={() => {
        viewState.setActiveViewId(props.view.id);
      }}
      onClick={() => {
        viewState.setActiveViewId(props.view.id);
      }}
    >
      {container && <ListHeader tabId={props.tabId} container={container} />}
      <SolidListContext.Provider value={ctx}>
        <div
          style={`display: flex; flex-direction: column; height: 100%;`}
          classList={{ [styles["focus"]]: ctx.isFocused() }}
        >
          <Tree />
        </div>
      </SolidListContext.Provider>
    </section>
  );
}
