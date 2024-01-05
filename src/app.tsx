import { For } from 'solid-js';
import { AcmeNav } from './nav/nav';
import { List } from './list/list';
import styles from './app.module.css';
import { viewState } from './view-state';
import { Bar } from './bar/bar';
import { View } from './view';
import Sidebar from './icons/sidebar.svg';
import Caret from './icons/caret.svg';
import CloudOffSVG from './icons/cloud-off.svg';
import SearchSVG from './icons/search.svg';
          
export function App() {
  return (
    <div class={styles.app}>
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
      <div class={styles.main}>
        <AcmeNav />
        <For each={viewState.list[0]()} fallback={<div>fallback</div>}>
          {(view, index) => <View view={view[0]()} tabId={index()} />}
        </For>
        <Bar />
      </div>
    </div>
  );
}
