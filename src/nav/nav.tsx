import { For, createSignal } from 'solid-js';
import styles from './nav.module.css';
import { replaceActiveView } from '../view-state';
import TodoSVG from '../icons/todo.svg';
import CornerDownRightSVG from '../icons/corner-down-right.svg';
import CheckSVG from '../icons/check.svg';
import { NavItemContextMenu } from './context-menu';

interface NavListItemProps {
  list: AcmeList,
}

export function NavListItem(props: NavListItemProps) {
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  return (
    <div style={`position: relative;`}>
      <button
        onClick={() => replaceActiveView(props.list.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          setCtxOpen(true);
        }}
      >
        <TodoSVG />
        <span>{props.list.name}</span>
      </button>
      {ctxOpen() && (
        <NavItemContextMenu
          close={() => setCtxOpen(false)}
          list={props.list}
        />
      )}
    </div>
  )
}

const lists: AcmeList[] = [
  {
    id: 'inbox',
    name: 'Inbox',
  },
  {
    id: 'acmelist',
    name: 'AcmeList',
  },
  {
    id: 'empty-list',
    name: 'Empty List',
  },
]

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
        <For each={lists}>
          {(list) => <NavListItem list={list} />}
        </For>
    </nav>
  );
}
