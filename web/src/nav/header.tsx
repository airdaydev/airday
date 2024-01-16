import { createSignal, Accessor } from 'solid-js';
import { ContextMenu } from '../context-menu/context-menu';
import { viewState } from '../view-state';
import Sidebar from '../icons/sidebar.svg';
import Caret from '../icons/caret.svg';
import CloudOffSVG from '../icons/cloud-off.svg';
import SearchSVG from '../icons/search.svg';
import styles from './header.module.css';
import { ThemeToggle } from '../theme/theme';

interface BordeContextMenuProps {
  close: () => void;
  offset: Accessor<[number, number]>;
}

export function BordeContextMenu(props: BordeContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      offset={props.offset}
    >
      <button
        onClick={() => {
          viewState.sidebarVisible[1]((prev) => !prev)
          props.close();
        }}
      >
        <span>{viewState.sidebarVisible[0]() ? 'Hide' : 'Show'} Sidebar</span>
      </button>
      <button disabled>
        <span>Settings</span>
      </button>
      <hr />
      <button disabled>
        <span>About</span>
      </button>
    </ContextMenu>
  )
}

interface WorkspaceContextMenuProps {
  close: () => void;
  offset: Accessor<[number, number]>;
}

export function WorkspaceContextMenu(props: WorkspaceContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      offset={props.offset}
    >
      <button disabled>
        <span>Import</span>
      </button>
      <button disabled>
        <span>Export</span>
      </button>
    </ContextMenu>
  )
}

export const Header = () => {
  // ContextMenu
  const [bordeCtxOpen, setBordeCtxOpen] = createSignal<'main' | 'workspace' | boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  function openContextMenu(event: MouseEvent, menu: 'main' | 'workspace') {
    event.preventDefault();
    if (event.target) {
      const bounds = event.target.getBoundingClientRect();
      setCtxOffset([bounds.left, bounds.bottom]);
      setBordeCtxOpen(menu);
    }
  }
  return (
    <header class={styles.header}>
      {bordeCtxOpen() === 'main' && (
        <BordeContextMenu
          offset={ctxOffset}
          close={() => setBordeCtxOpen(false)}
        />
      )}
      {bordeCtxOpen() === 'workspace' && (
        <WorkspaceContextMenu
          offset={ctxOffset}
          close={() => setBordeCtxOpen(false)}
        />
      )}
      <div class={styles['nav-section']}>
        <button
          class={styles['nav-button']}
          style={'font-weight: 500;'}
          onClick={(event) => openContextMenu(event, 'main')}
          onMouseOver={(event) => {
            if (bordeCtxOpen()) openContextMenu(event, 'main')
          }}
        >
          Borde
        </button>
        <button
          class={`${styles['workspace-button']} ${styles['nav-button']}`}
          onClick={(event) => openContextMenu(event, 'workspace')}
          onMouseOver={(event) => {
            if (bordeCtxOpen()) openContextMenu(event, 'workspace')
          }}
        >
          Workspace 1
        </button>
      </div>
      <div class={styles['nav-section']}>
        <ThemeToggle class={styles['nav-button']} />
        <button class={styles['nav-button']} >
          <SearchSVG />
        </button>
        <button class={styles['nav-button']} >
          <CloudOffSVG />
        </button>
        <button class={`${styles['workspace-button']} ${styles['nav-button']}`}>
          <span style="padding-right: 0.25em;">Daniel</span>
          <Caret style="stroke-width: 1.25px; width: 0.75em; height: 0.75em;" />
        </button>
      </div>
    </header>
  );
}
