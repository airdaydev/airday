import { For, createSignal, Accessor } from 'solid-js';
import styles from './nav.module.css';
import { viewState } from '../view-state';
import TodoSVG from '../icons/todo.svg';
import CornerDownRightSVG from '../icons/corner-down-right.svg';
import CheckSVG from '../icons/check.svg';
import ChevronDownSVG from '../icons/chevron-down.svg';
import { NavItemContextMenu } from './context-menu';
import { store } from '../store/main';
import { AddListButton } from './add-list';

interface NavListItemProps {
  container: Accessor<AcmeContainer>,
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
        ref={button}
        onClick={() => viewState.openContainerView(props.container().id)}
        onContextMenu={(event: MouseEvent) => {
          event.preventDefault();
          if (button) {
            const bbox = button.getBoundingClientRect();
            const offsetLeft = event.clientX - bbox.left;
            const offsetRight = event.clientY - bbox.top;
            setCtxOffset([offsetLeft, offsetRight]);
            setCtxOpen(true);
          }
        }}
      >
        <TodoSVG style={`display: block;flex-shrink: 0;height: 1.25rem;width: 1.25rem;`} />
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
      <div class={styles['nav-list']}>
        <button>
          <CornerDownRightSVG style="width: 1.25em; stroke-width: 1.25px;" />
          <span>Up Next</span>
        </button>
        <button onClick={viewState.openDoneView}>
          <CheckSVG style="width: 1.25em; stroke-width: 1.25px;" />
          <span>Done</span>
        </button>
      </div>
        <hr style="width: 100%; border: none; border-top: 1px solid var(--border, value);" />
        <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
          By area
        </h2>
        <div class={styles['nav-list']}>
          <For each={store.containerModel.ol()}>
            {(container) => <NavListItem container={container} />}
          </For>
          <AddListButton />
        </div>
        <section class={styles['nav-list']}>
          <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
            By sticker
          </h2>
          <div>
            <button>
              TODO: Sticker
            </button>
          </div>
        </section>
        <section class={styles['nav-list']}>
          <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
            By filter
          </h2>
          <div>
            <button>
              Most neglected
            </button>
          </div>
        </section>
        <section>
          <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
            Dev
          </h2>
          <div>
            <button onClick={store.reset}>
              Refresh db
            </button>
          </div>
        </section>
    </nav>
  );
}
