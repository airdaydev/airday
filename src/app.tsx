import { createSignal, For } from 'solid-js';
import { AcmeNav } from './nav/nav';
import { List } from './list/list';
import styles from './app.module.css';
import { viewState } from './view-state';

export function App() {
  return (
    <div class={styles.App}>
      <AcmeNav />
      <For each={viewState.list[0]()} fallback={<div>fallback</div>}>
        {/* TODO: Views should have ids, not just indexes */}
        {(view, index) => <List view={view[0]()} tabId={index()} />}
      </For>
    </div>
  );
}
