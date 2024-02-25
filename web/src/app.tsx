import { For, createContext } from 'solid-js';
import { BordeNav } from './nav/nav';
import { List } from './list/list';
import styles from './app.module.css';
import { viewState } from './view-state';
// import { Bar } from './bar/bar';
import { View } from './view';
import { Header } from './nav/header';


// TODO: Switch workspace
export function App() {
  // if focus mode
  return (
    <div class={styles.app}>
      <Header />
      <div class={styles.main}>
        <BordeNav />
        <For each={viewState.list[0]()} fallback={<div>fallback</div>}>
          {(view, index) => <View view={view[0]()} tabId={index()} />}
        </For>
      </div>
    </div>
  );
}
