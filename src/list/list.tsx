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
  let containerRef;
  const liveList = openList(props.listId);
  if (!liveList) throw new Error('List not found');
  const selection = new AcmeReactiveSelection();
  // TODO: Incorporate into handler and wire up to top level keyboard module
  const contextId = nanoid();
  keyboardShortcuts.registerHandler('keydown', contextId, (event: KeyboardEvent) => {
    const list = liveList.signal();
    if (event.key === 'Escape') {
      event.preventDefault();
      selection.clear();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // - on key down, select next down, set selection origin
      if (!selection.lastKeySelected) {
        const neighbour = list[0];
        if (neighbour) selection.selectOne(neighbour.id);
        return;
      }
      if (selection.lastKeySelected && !event.shiftKey) {
        const neighbour = liveList.getNeighbourIndex(selection.lastKeySelected);
        if (neighbour) selection.selectOne(list[neighbour].id);
      }
      if (selection.rangeOrigin && event.shiftKey) {
        // contiguous area below origin, continue:
        const origin = liveList.getIndexOfKey(selection.rangeOrigin);
        if (origin === false) return; // Nothing below
        const index = liveList.getNextNotInSet(origin, selection.keys);
        if (index) selection.addKey(list[index].id);
      }
    }
    // - on key up, select next up, set selection origin
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!selection.lastKeySelected) {
        const neighbour = list[list.length - 1];
        if (neighbour) selection.selectOne(neighbour.id);
        return;
      } else {
        const neighbour = liveList.getNeighbourIndex(selection.lastKeySelected, 'prev');
        if (neighbour) selection.selectOne(liveList.signal()[neighbour].id);
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
        <div ref={containerRef}>
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
        </div>
    </section>
  );
}
