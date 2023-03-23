import { For } from 'solid-js';
import { AcmeNav } from './nav/nav';
import { List } from './list/list';
import styles from './app.module.css';
import { viewState } from './view-state';
import { Bar } from './bar/bar';

export function App() {
  return (
    <div class={styles.app}>
      <AcmeNav />
      <For each={viewState.list[0]()} fallback={<div>fallback</div>}>
        {(view, index) => <List view={view[0]()} tabId={index()} />}
      </For>
      <Bar />
    </div>
  );
}
