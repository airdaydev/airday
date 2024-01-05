import { viewState } from './view-state';
import styles from './app.module.css';
import Sidebar from './icons/sidebar.svg';
import Caret from './icons/caret.svg';
import CloudOffSVG from './icons/cloud-off.svg';
import SearchSVG from './icons/search.svg';

export const Header = () => (
  <header class={styles.header}>
    <div class={styles['nav-section']}>
      <div>Workspace 1</div>
      <Caret />
      <button onClick={() => viewState.sidebarVisible[1]((prev) => !prev)}>
      <Sidebar />
      </button>
    </div>
    <div class={styles['nav-section']}>
      <SearchSVG />
      <CloudOffSVG />
      <div>Daniel</div>
    </div>
  </header>
)