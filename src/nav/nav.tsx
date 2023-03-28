import { For, createSignal, Accessor } from 'solid-js';
import styles from './nav.module.css';
import { viewState } from '../view-state';
import TodoSVG from '../icons/todo.svg';
import CornerDownRightSVG from '../icons/corner-down-right.svg';
import CheckSVG from '../icons/check.svg';
import ChevronDownSVG from '../icons/chevron-down.svg';
import { NavItemContextMenu } from './context-menu';
import { containerModel } from '../store/main';
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
        onClick={() => viewState.replaceActiveView(props.container().id)}
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
        <span style='overflow-x: hidden; text-overflow: ellipsis; white-space: nowrap;'>
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
  return (
    <nav class={styles.nav} style={{
      'margin-left': sidebarVisible() ? '-210px' : '0',
    }}>
      <div class={styles['nav-list']}>
        <button>
          <CornerDownRightSVG style="width: 1.25em; stroke-width: 1.25px;" />
          <span>Up Next</span>
        </button>
        <button>
          <CheckSVG style="width: 1.25em; stroke-width: 1.25px;" />
          <span>Done</span>
        </button>
      </div>
        <hr style="width: 100%; border: none; border-top: 1px solid var(--border, value);" />
        <h2 style='font-size: 1rem; font-weight: 500; padding: 0 0.5em;'>
          Lists
        </h2>
        <div class={styles['nav-list']}>
          <For each={containerModel.ol()}>
            {(container) => <NavListItem container={container} />}
          </For>
          <AddListButton />
        </div>
        <div style={`
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5em 1em;
          border-radius: 5px;
          margin-top: auto;
          border: 1px solid #ccc;
        `}>
          <span>Daniel's Space</span>
          <ChevronDownSVG style='width: 1em;' />
        </div>
    </nav>
  );
}
