import { For, createSignal } from 'solid-js';
import styles from './nav.module.css';
import { replaceActiveView } from '../view-state';
import TodoSVG from '../icons/todo.svg';
import CornerDownRightSVG from '../icons/corner-down-right.svg';
import CheckSVG from '../icons/check.svg';
import { NavItemContextMenu } from './context-menu';
import { containerModel } from '../store/main';
import { nanoid } from 'nanoid';

interface NavListItemProps {
  list: AcmeContainer,
}

// TODO: Turn off keyboard when context menu open
export function NavListItem(props: NavListItemProps) {
  let button: HTMLButtonElement | undefined;
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  return (
    <div style={`position: relative;`}>
      <button
        ref={button}
        onClick={() => replaceActiveView(props.list.id)}
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
        <TodoSVG />
        <span>{props.list.name}</span>
      </button>
      {ctxOpen() && (
        <NavItemContextMenu
          close={() => setCtxOpen(false)}
          list={props.list}
          offset={ctxOffset}
        />
      )}
    </div>
  )
}

export function AcmeNav() {
  return (
    <nav class={styles.nav}>
        <button>
          <CornerDownRightSVG />
          <span>Up Next</span>
        </button>
        <button>
          <CheckSVG />
          <span>Done</span>
        </button>
        <hr />
        <For each={containerModel.accessor()}>
          {(list) => <NavListItem list={list} />}
        </For>
        <button onClick={() => containerModel.insert({
          id: nanoid(),
          name: 'New list',
        })}>
          + Create new list
        </button>
    </nav>
  );
}
