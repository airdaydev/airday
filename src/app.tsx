import { For } from 'solid-js';
import { AcmeNav } from './nav/nav';
import { List } from './list/list';
import styles from './app.module.css';
import { listViews, setListViews } from './view-state';

export function App() {
  return (
    <div class={styles.App}>
      <AcmeNav />
      <For each={listViews} fallback={<div>fallback</div>}>
        {/* TODO: Views should have ids, not just indexes */}
        {(item, index) => <List listId={item} tabId={index()} />}
      </For>
    </div>
  );
}
