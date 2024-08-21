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

interface ListProps {
  view: BordeView;
  tabId: number;
}

export function List(props: ListProps) {
  const session = useContext(sessionContext);
  const ctx = session.workspace.openList(props.view);
  return (
    <section
      classList={
        {
          // [styles.list]: true,
          // [styles.active]: viewState.activeViewId() === props.view.id,
        }
      }
      tabIndex={props.tabId}
      onFocus={() => {
        viewState.setActiveViewId(props.view.id);
      }}
      onClick={() => {
        viewState.setActiveViewId(props.view.id);
      }}
    >
      Placeholder for {props.view.id}
      <div class={styles["list"]}>
        <SolidListContext.Provider value={ctx}>
          <div
            style={`display: flex; flex-direction: column; height: 100%; width: 33.3%;`}
            classList={{ [styles["focus"]]: ctx.isFocused() }}
          >
            <h3>Tree A ({ctx.treeState.count()} items)</h3>
            <Tree />
          </div>
        </SolidListContext.Provider>
      </div>
    </section>
  );
}
