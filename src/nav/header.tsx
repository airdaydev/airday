import { viewState } from '../view-state';
import Sidebar from '../icons/sidebar.svg';
import Caret from '../icons/caret.svg';
import CloudOffSVG from '../icons/cloud-off.svg';
import SearchSVG from '../icons/search.svg';
import styles from './header.module.css';
import { ThemeToggle } from '../theme/theme';

export const Header = () => (
  <header class={styles.header}>
    <div class={styles['nav-section']}>
      <button
        onClick={() => viewState.sidebarVisible[1]((prev) => !prev)}
        style="background: none; border: none; cursor: pointer;"
      >
        <Sidebar style="stroke-width: 1.25px; top: 1.5px; position: relative;" />
      </button>
      <button class={styles['workspace-button']}>
        <span style="padding-right: 0.25em;">Workspace 1</span>
        <Caret style="stroke-width: 1.25px; width: 0.75em; height: 0.75em;" />
      </button>
    </div>
    <div class={styles['nav-section']}>
      <ThemeToggle />
      <SearchSVG />
      <CloudOffSVG />
      <button class={styles['workspace-button']}>
        <span style="padding-right: 0.25em;">Daniel</span>
        <Caret style="stroke-width: 1.25px; width: 0.75em; height: 0.75em;" />
      </button>
    </div>
  </header>
)
