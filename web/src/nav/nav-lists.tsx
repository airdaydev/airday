import { For, createSignal, Accessor, useContext } from "solid-js";
import { ListIcon } from "../list/list-icon";
import { viewState } from "../view/state";
import { sessionContext } from "../store/context.js";
import { AddListButton } from "./add-list";
import { NavItemContextMenu } from "./context-menus";
import { NodeComponentType } from "@borde/list";
import styles from "./nav.module.css";
import { ListDragContext, SolidListContext, Tree } from "@borde/list";

// TODO: Turn off keyboard when context menu open
export const NavListItem: NodeComponentType = (props) => {
  const node = props.node.accessor;
  let button: HTMLButtonElement | undefined;
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  return (
    <div style={`position: relative;`}>
      <button
        classList={{
          [styles.active]: viewState.isContainerActive(node().id),
          [styles["nav-text-button"]]: true,
        }}
        onClick={() => viewState.openContainerView(node().id)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
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
          {node() && node().name}
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
    treeState: session.workspace.containerModel.tree,
    dndContext: session.workspace.containerModel.dndContext,
    itemHeight: 32,
    placeholderStyle: styles["placeholder"],
  });
  return (
    <div class={`${styles["nav-list"]} ${styles["nav-text"]}`}>
      <SolidListContext.Provider value={listDragContext}>
        <Tree hideBackdrop />
      </SolidListContext.Provider>
    </div>
  );
};
