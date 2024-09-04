import { For, createSignal, Accessor, useContext } from "solid-js";
import { ListIcon } from "../list/list-icon";
import { viewState } from "../view-state";
import { sessionContext } from "../store/context.js";
import { AddListButton } from "./add-list";
import { NavItemContextMenu } from "./context-menus";
import styles from "./nav.module.css";

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

export const NavLists = () => {
  const session = useContext(sessionContext);
  return (
    <div class={`${styles["nav-list"]} ${styles["nav-text"]}`}>
      <For each={session.workspace.containerModel.ol()}>
        {(container) => <NavListItem container={container} />}
      </For>
      <AddListButton />
    </div>
  );
};
