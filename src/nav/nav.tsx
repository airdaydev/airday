import { For, createSignal, Accessor } from 'solid-js';
import { Stickers } from './stickers';
import styles from './nav.module.css';
import { viewState } from '../view-state';
import CornerDownRightSVG from '../icons/corner-down-right.svg';
import CheckSVG from '../icons/check.svg';
import TrashSVG from '../icons/trash.svg';
import { ListIcon } from '../list/list-icon';
import { ContextMenu } from '../context-menu/context-menu';
import { store } from '../store/main';
import { AddListButton } from './add-list';

interface NavItemContextMenuProps {
  close: () => void;
  container: Accessor<BordeContainer>,
  offset: Accessor<[number, number]>;
}

export function NavItemContextMenu(props: NavItemContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      container={props.container}
      offset={props.offset}
    >
      <button onClick={() => {
        viewState.addContainerView(props.container().id);
        props.close();
      }}>
        <span>Open in new view</span>
      </button>
      <button disabled>
        <span>Export</span>
      </button>
      <button disabled>
        <span>Delete</span>
      </button>
    </ContextMenu>
  )
}

interface NavListItemProps {
  container: Accessor<BordeContainer>,
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
        <span style='overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-y: hidden;'>
          {props.container() && props.container().name}
        </span>
      </button>
      {ctxOpen() && (
        <NavItemContextMenu
          close={() => setCtxOpen(false)}
          container={props.container}
          offset={ctxOffset}
        />
      )}
    </div>
  )
}

export function AcmeNav() {
  const [ sidebarVisible ] = viewState.sidebarVisible;
  let ref: HTMLDivElement | undefined = undefined;
  const getMargin = () => sidebarVisible() ? '0' : `-${ref ? ref.getBoundingClientRect().width : 0}px`;
  return (
    <nav
      class={styles.nav}
      ref={ref}
      style={{
        'margin-left': getMargin(),
      }}
    >
      <div
        class={`${styles['nav-list']} ${styles['nav-text']}`}
        style="border-top: 1px solid var(--border); padding-top: 0.5em;"
      >
        <button>
          <CornerDownRightSVG style="width: 1.25em; stroke-width: 1.25px;" />
          <span>Up Next</span>
        </button>
        <button onClick={viewState.openDoneView}>
          <CheckSVG style="width: 1.25em; stroke-width: 1.25px;" />
          <span>Done</span>
        </button>
        <button onClick={viewState.openDoneView}>
          <TrashSVG style="width: 1.25em; stroke-width: 1.25px;" />
          <span>Trash</span>
        </button>
      </div>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
        Boards
      </h2>
      <div class={`${styles['nav-list']} ${styles['nav-text']}`}>
        <For each={store.containerModel.ol()}>
          {(container) => <NavListItem container={container} />}
        </For>
        <AddListButton />
      </div>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <Stickers />
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <section class={`${styles['nav-list']} ${styles['nav-text']}`}>
        <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
          Filters
        </h2>
        <div>
          <button>
            Most neglected
          </button>
        </div>
      </section>
      <hr style="width: 100%; border: none; border-top: 1px solid var(--border);" />
      <section>
        <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
          Dev
        </h2>
        <div class={`${styles['nav-list']} ${styles['nav-text']}`}>
          <button onClick={store.reset}>
            Refresh db
          </button>
        </div>
      </section>
    </nav>
  );
}
