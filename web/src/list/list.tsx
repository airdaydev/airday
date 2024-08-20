import { useContext } from "solid-js";
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
      Placeholder
    </section>
  );
}
