import { For, createSignal, Accessor } from 'solid-js';
import styles from './nav.module.css';
import { viewState } from '../view-state';
import TodoSVG from '../icons/todo.svg';
import CornerDownRightSVG from '../icons/corner-down-right.svg';
import CheckSVG from '../icons/check.svg';
import PlusSVG from '../icons/plus.svg';
import { NavItemContextMenu } from './context-menu';
import { containerModel } from '../store/main';
import { nanoid } from 'nanoid';

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
        <TodoSVG style={`display: block;flex-shrink: 0;`} />
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
  return (
    <nav class={styles.nav}>
      <div class={styles['nav-list']}>
        <button>
          <CornerDownRightSVG />
          <span>Up Next</span>
        </button>
        <button>
          <CheckSVG />
          <span>Done</span>
        </button>
      </div>
        <hr style="width: 100%; border: none; border-top: 1px solid var(--border, value);" />
        <div style={'display: flex; justify-content: space-between; align-items: center;'}>
          <h2 style='font-size: 1rem; font-weight: 500; padding: 0 0.5em;'>Lists</h2>
          <button
            style='border: none; background: none; cursor: pointer; padding: 0.5em;'
            onClick={() => {
              const id = nanoid();
              containerModel.insert({
                id,
                name: 'New list',
              });
              viewState.replaceActiveView(id);
          }}
          >
            <PlusSVG style={'width: 1em; height: 1em;'} />
          </button>
        </div>
        <div class={styles['nav-list']}>
          <For each={containerModel.ol()}>
            {(container) => <NavListItem container={container} />}
          </For>
        </div>
    </nav>
  );
}
