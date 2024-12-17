import { createSignal, onCleanup, onMount, useContext } from "solid-js";
import { ListIcon } from "../list/list-icon";
import { sessionContext } from "../store/context.js";
import { NavItemContextMenu } from "./context-menus";
import { NodeComponentType } from "@air-app/list";
import styles from "./nav.module.css";
import FolderSVG from "../icons/folder.svg?component-solid";
import { TreeContext, SolidListContext, Tree } from "@air-app/list";
import { DataView } from "../view/state";
import { ContainerFolderNode, ContainerNode } from "../store/container";

export const FolderNodeComponent: NodeComponentType<ContainerFolderNode> = (
  props,
) => {
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
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          props.onMouseDown(event);
          setCtxOffset([event.clientX, event.clientY]);
          setCtxOpen(true);
        }}
        onMouseDown={props.onMouseDown}
        draggable={props.draggable}
        data-index={props.index}
        ref={props.ref}
        aria-selected={props.ariaSelected}
        style={{
          "padding-left": props.node.accessor().depth
            ? `${props.node.accessor().depth * 10}px`
            : "20px", // TODO: Do not overwrite existing button depth
        }}
      >
        {/* <ListIcon container={node()} /> */}
        <FolderSVG style={"width: 1em; height: 1em;"} />
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

// TODO: Turn off keyboard when context menu open
export const ContainerNodeComponent: NodeComponentType<ContainerNode> = (
  props,
) => {
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
        style={{
          "padding-left": props.node.accessor().depth
            ? `${props.node.accessor().depth * 10}px`
            : "20px", // TODO: Do not overwrite existing button depth
        }}
        tabindex="-1"
        onClick={() => session.viewState.openDataView(node().id)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          props.onMouseDown(event);
          setCtxOffset([event.clientX, event.clientY]);
          setCtxOpen(true);
        }}
        draggable={props.draggable}
        onMouseDown={(event) => {
          session.viewState.paneDropView = new DataView(
            session.viewState,
            node().id,
          );
          props.onMouseDown(event);
        }}
        // onTouchStart={(event) => {
        //   session.viewState.paneDropView = new DataView(
        //     session.viewState,
        //     node().id,
        //   );
        //   props.onTouchStart(event);
        // }}
        // data-index={props.index}
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
  const treeContext = new TreeContext({
    id: "navlist",
    treeState: session.workspace.containerStore.tree,
    dndContext: session.workspace.containerStore.dndContext,
    itemHeight: 32,
    fitContent: true,
    bottomRowPadding: 0,
    shadowColor: [100, 100, 100],
  });
  onCleanup(() => {
    session.workspace.containerStore.dndContext.listContexts.delete(
      treeContext,
    );
  });
  return (
    <SolidListContext.Provider value={treeContext}>
      <Tree />
    </SolidListContext.Provider>
  );
};
