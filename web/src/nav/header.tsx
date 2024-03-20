import { sessionContext } from '../store/context.js';
import { createSignal, useContext } from 'solid-js';
import CloudOffSVG from '../icons/cloud-off.svg';
import SearchSVG from '../icons/search.svg';
import styles from './header.module.css';
import { ThemeToggle } from '../theme/theme';
import { BordeContextMenu, WorkspaceContextMenu } from './context-menus';
import { AccountButton } from './account-button';

type ContextMenu = 'main' | 'workspace';

export const Header = () => {
  // ContextMenu
  const session = useContext(sessionContext);
  const [ctxOpen, setCtxOpen] = createSignal<ContextMenu | boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  function openContextMenu(event: MouseEvent, menu: ContextMenu) {
    event.preventDefault();
    if (event.target) {
      const bounds = event.target.getBoundingClientRect();
      setCtxOffset([bounds.left, bounds.bottom]);
      setCtxOpen(menu);
    }
  }
  return (
    <header class={styles.header}>
      {ctxOpen() === 'main' && (
        <BordeContextMenu
          close={() => setCtxOpen(false)}
          offset={ctxOffset()}
        />
      )}
      {ctxOpen() === 'workspace' && (
        <WorkspaceContextMenu
          close={() => setCtxOpen(false)}
          offset={ctxOffset()}
        />
      )}
      <div class={styles['nav-section']}>
        <button
          class={styles['nav-button']}
          style={'font-weight: 500;'}
          onClick={(event) => openContextMenu(event, 'main')}
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, 'main')
          }}
        >
          Borde
        </button>
        <button
          class={`${styles['workspace-button']} ${styles['nav-button']}`}
          onClick={(event) => openContextMenu(event, 'workspace')}
          onMouseOver={(event) => {
            if (ctxOpen()) openContextMenu(event, 'workspace')
          }}
        >
          {session.workspace.name}
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
        <AccountButton />
      </div>
    </header>
  );
}
