import { createSignal } from 'solid-js';
import Caret from '../icons/caret.svg';
import CloudOffSVG from '../icons/cloud-off.svg';
import SearchSVG from '../icons/search.svg';
import styles from './header.module.css';
import { ThemeToggle } from '../theme/theme';
import { BordeContextMenu, WorkspaceContextMenu, AccountContextMenu } from './context-menus';

type ContextMenu = 'main' | 'workspace' | 'account';

export const Header = () => {
  // ContextMenu
  const [bordeCtxOpen, setBordeCtxOpen] = createSignal<ContextMenu | boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  function openContextMenu(event: MouseEvent, menu: ContextMenu) {
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
      {bordeCtxOpen() === 'account' && (
        <AccountContextMenu
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
        <button
          class={`${styles['workspace-button']} ${styles['nav-button']}`}
          onClick={(event) => openContextMenu(event, 'account')}
        >
          <span style="padding-right: 0.25em;">Daniel</span>
          <Caret style="stroke-width: 1.25px; width: 0.75em; height: 0.75em;" />
        </button>
      </div>
    </header>
  );
}
