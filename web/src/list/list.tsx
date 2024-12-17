import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  useContext,
} from "solid-js";
import styles from "./list.module.css";
import itemStyles from "../item/item.module.css";
import { DataView } from "../view/state";
import { Tree, SolidListContext, TreeContext } from "@air-app/list";
import { sessionContext } from "../store/context.js";
import { ListHeader } from "./list-header";
import NullList from "./null-list";
import { listOptions, ListOptionsContext } from "./list-options";
import { ListColumnHeaders } from "./list-col-head";
import { canvasDarkBg, canvasLightBg, theme } from "../theme/theme";

interface ListProps {
  view: DataView;
}

export function List(props: ListProps) {
  const session = useContext(sessionContext);
  const list = session.workspace.openList(props.view);
  const ctx = new TreeContext({
    treeState: list.tree,
    dndContext: session.workspace.dndContext,
    itemHeight: 32,
  });
  const container = session.workspace.containerStore.tree.idMap.get(
    props.view.containerId,
  );

  onCleanup(() => {
    session.workspace.dndContext.listContexts.delete(ctx);
  });

  createEffect(() => {
    if (theme[0]() === "dark") {
      if (ctx.canvas) ctx.canvas.shadowColor = canvasDarkBg;
    } else {
      if (ctx.canvas) ctx.canvas.shadowColor = canvasLightBg;
    }
  });

  createEffect(() => {
    const activePane = session.viewState.activePane[0]();
    if (activePane === props.view) {
      ctx.setFocus();
    }
    // if (ctx.dndContext.focusContext[0]() === ctx) {
    //   session.viewState.setActivePane(props.view);
    // }
  });
  onMount(() => {
    ctx.setFocus();
    session.viewState.setActivePane(props.view);
  });
  const opts = listOptions();
  return (
    <>
      <Show when={container} fallback={<NullList view={props.view} />}>
        <ListOptionsContext.Provider value={opts}>
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
            {opts.columnHeaders[0]() && <ListColumnHeaders />}
            <SolidListContext.Provider value={ctx}>
              <div class={styles["tree-wrap"]}>
                <Tree />
              </div>
            </SolidListContext.Provider>
          </section>
        </ListOptionsContext.Provider>
      </Show>
    </>
  );
}
