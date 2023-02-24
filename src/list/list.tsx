import {
  createResource, createSignal, For, onCleanup,
} from 'solid-js';
import { AcmeReactiveSelection } from '../list/selection.js';
import styles from './list.module.css';
import { Item } from '../item/item';
import { store } from '../store/main';
import { openList } from '../store/list-tree.js';
import { nanoid } from 'nanoid';
import { keyboardShortcuts } from '../keyboard.js';

interface ListProps {
  listId: string;
  tabId: number;
}

// const bigList = new Array(2000).fill(0).map((val, index, arr) => ({
//   id: index,
//   text: `yo-${index}`,
// }));

// Challenge, index tracking without refreshing the list

/**
 * A virtual, ordered list supporting inter-list drag & drop
 * @param props 
 * @returns 
 */
export function List(props: ListProps) {
  const liveList = openList(props.listId);
  if (!liveList) throw new Error('List not found');
  const selection = new AcmeReactiveSelection();
  // TODO: Incorporate into handler and wire up to top level keyboard module
  const contextId = nanoid();
  keyboardShortcuts.registerHandler('keydown', contextId, (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (selection.origin) {
        const neighbour = liveList.getNeighbour(selection.origin);
        if (neighbour) selection.selectOne(neighbour.id);
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (selection.origin) {
        const neighbour = liveList.getNeighbour(selection.origin, 'prev');
        if (neighbour) selection.selectOne(neighbour.id);
      }
    }
  })
  onCleanup(() => {
    keyboardShortcuts.unregisterHandler('keydown', contextId)
    console.log(`cleaning up list ${props.listId}`)
  })
  return (
    <section
      class={styles.list}
      tabIndex={props.tabId}
      onFocus={() => keyboardShortcuts.setFocus(contextId)}
    >
        <h2>{props.listId}</h2>
        <For each={liveList.signal()}>
          {(item, index) => (
            <Item
              item={item}
              listIndex={index()}
              selection={selection}
              // liveList={liveList}
            />
          )}
        </For>
    </section>
  );
}
