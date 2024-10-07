import { createSignal, onCleanup, useContext } from "solid-js";
import { ListIcon } from "../list/list-icon";
import { sessionContext } from "../store/context.js";
import { NavItemContextMenu } from "./context-menus";
import { NodeComponentType } from "@sunlist/list";
import styles from "./nav.module.css";
import { ListDragContext, SolidListContext, Tree } from "@sunlist/list";

// TODO: Turn off keyboard when context menu open
export const NavListItem: NodeComponentType = (props) => {
  const session = useContext(sessionContext);
  const node = props.node.accessor;
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  return (
    <div style={`position: relative;`}>
      <button
        classList={{
          [styles.active]:
            session.viewState.activePane[0]()?.containerId === node().id,
          [styles["nav-text-button"]]: true,
        }}
        tabindex="-1"
        onClick={() => session.viewState.openDataView(node().id)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          props.onMouseDown(event);
          setCtxOffset([event.clientX, event.clientY]);
          setCtxOpen(true);
        }}
        onMouseDown={(event) => {
          props.onMouseDown(event);
        }}
        onTouchStart={(event) => {
          props.onTouchStart(event);
        }}
        data-index={props.index}
        ref={props.ref}
        aria-selected={props.ariaSelected}
      >
        <ListIcon container={node()} />
        <span style="overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-y: hidden;">
          {node().name}
        </span>
        <span style="margin-left: auto; color: var(--body-tint); font-size: 0.9em;">
          {node().default && "Default"}
        </span>
      </button>
      {ctxOpen() && (
        <NavItemContextMenu
          close={() => setCtxOpen(false)}
          container={node}
          offset={ctxOffset()}
        />
      )}
    </div>
  );
};

export const NavLists = () => {
  const session = useContext(sessionContext);
  const listDragContext = new ListDragContext({
    treeState: session.workspace.containerStore.tree,
    dndContext: session.workspace.containerStore.dndContext,
    itemHeight: 32,
    placeholderStyle: styles["placeholder"],
  });
  onCleanup(() => {
    session.workspace.containerStore.dndContext.listContexts.delete(
      listDragContext,
    );
  });
  return (
    <div class={`${styles["nav-list"]} ${styles["nav-text"]}`}>
      <SolidListContext.Provider value={listDragContext}>
        <Tree hideBackdrop />
      </SolidListContext.Provider>
    </div>
  );
};
