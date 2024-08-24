import { For, createSignal, Accessor, useContext } from "solid-js";
import { Stickers } from "./stickers";
import styles from "./nav.module.css";
import { viewState } from "../view-state";
import NextSVG from "../icons/next.svg?component-solid";
import PerformanceSVG from "../icons/activity.svg?component-solid";
import CalendarSVG from "../icons/calendar.svg?component-solid";
import CheckSVG from "../icons/check.svg?component-solid";
import TrashSVG from "../icons/trash.svg?component-solid";
import { ListIcon } from "../list/list-icon";
import { ContextMenu } from "../context-menu/context-menu";
import { sessionContext } from "../store/context.js";
import { AddListButton } from "./add-list";

interface NavItemContextMenuProps {
  close: () => void;
  container: Accessor<BordeContainer>;
  offset: [number, number];
}

export function NavItemContextMenu(props: NavItemContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      container={props.container}
      offset={props.offset}
    >
      <button
        onClick={() => {
          viewState.addContainerView(props.container().id);
          props.close();
        }}
      >
        <span>Open in new view</span>
      </button>
      <button disabled>
        <span>Export</span>
      </button>
      <button disabled>
        <span>Delete</span>
      </button>
    </ContextMenu>
  );
}

interface NavListItemProps {
  container: Accessor<BordeContainer>;
}

// TODO: Turn off keyboard when context menu open
export function NavListItem(props: NavListItemProps) {
  let button: HTMLButtonElement | undefined;
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  return (
    <div style={`position: relative;`}>
      <button
        classList={{
          [styles.active]: viewState.isContainerActive(props.container().id),
        }}
        onClick={() => viewState.openContainerView(props.container().id)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          setCtxOffset([event.clientX, event.clientY]);
          setCtxOpen(true);
        }}
      >
        <ListIcon container={props.container()} />
        <span style="overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-y: hidden;">
          {props.container() && props.container().name}
        </span>
      </button>
      {ctxOpen() && (
        <NavItemContextMenu
          close={() => setCtxOpen(false)}
          container={props.container}
          offset={ctxOffset()}
        />
      )}
    </div>
  );
}

export function BordeNav() {
  const session = useContext(sessionContext);
  const [sidebarVisible] = viewState.sidebarVisible;
  let ref: HTMLDivElement | undefined = undefined;
  const getMargin = () =>
    sidebarVisible()
      ? "0"
      : `-${ref ? ref.getBoundingClientRect().width : 0}px`;
  return (
    <nav
      class={styles.nav}
      ref={ref}
      style={{
        "margin-left": getMargin(),
      }}
    >
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border); margin: 0;" />
      <div
        class={`${styles["nav-list"]} ${styles["nav-text"]}`}
        style="padding-top: 0.5em;"
      >
        <button>
          <NextSVG
            style="position: relative;
            width: 1.25em;
            stroke-width: 0.75px;
            left: 2px;
            height: 1.5em;
            color: var(--body-tint);"
          />
          <span>Next</span>
        </button>
        <button>
          <PerformanceSVG style="width: 1.25em; stroke-width: 1.5px; color: var(--body-tint);" />
          <span>Performance</span>
        </button>
        <button onClick={viewState.openDoneView}>
          <CheckSVG style="width: 1.25em; stroke-width: 1.25px; color: var(--body-tint);" />
          <span>Done</span>
        </button>
      </div>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <div class={`${styles["nav-list"]} ${styles["nav-text"]}`}>
        <For each={session.workspace.containerModel.ol()}>
          {(container) => <NavListItem container={container} />}
        </For>
        <AddListButton />
      </div>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <Stickers />
      <div style="color: #81777f; border: none; background: none; cursor: pointer; padding: 0.5em; outline: 0; font-family: inherit; font-size: 1rem;">
        Add stickers
      </div>
      {/* <button>
        <CalendarSVG style="width: 1.25em; stroke-width: 1.25px;" />
        <span>Scheduled</span>
      </button>
      <button onClick={viewState.openDoneView}>
        <TrashSVG style="width: 1.25em; stroke-width: 1.25px;" />
        <span>Trash</span>
      </button> */}
    </nav>
  );
}
