import { For } from 'solid-js';
import { AcmeNav } from './nav/nav';
import { List } from './list/list';
import styles from './app.module.css';
import { viewState } from './view-state';
import { Bar } from './bar/bar';
import { View } from './view';
import { Header } from './header';
          
export function App() {
  return (
    <div class={styles.app}>
      <Header />
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
