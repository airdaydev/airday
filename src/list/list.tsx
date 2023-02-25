import {
  createResource, createSignal, For, onCleanup, onMount,
} from 'solid-js';
import { AcmeReactiveSelection } from '../list/selection.js';
import styles from './list.module.css';
import { Item } from '../item/item';
import { store } from '../store/main';
import { openList } from '../store/open-list.js';
import { nanoid } from 'nanoid';
import { keyboardShortcuts } from '../keyboard.js';
import { getListKeyboardHandler } from './keyboard-handler.js';

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
  let containerRef: HTMLDivElement;
  let scrollRef: HTMLDivElement;
  const liveList = openList(props.listId);
  if (!liveList) throw new Error('List not found');
  const selection = new AcmeReactiveSelection();
  // TODO: Incorporate into handler and wire up to top level keyboard module
  const contextId = nanoid();
  onMount(() => {
    keyboardShortcuts.registerHandler('keydown', contextId, getListKeyboardHandler({
      liveList,
      selection,
      containerRef,
      scrollRef,
    }));
  });
  onCleanup(() => {
    keyboardShortcuts.unregisterHandler('keydown', contextId)
    console.log(`cleaning up list ${props.listId}`)
  })
  return (
    <section
      class={styles.list}
      tabIndex={props.tabId}
      onFocus={() => keyboardShortcuts.setFocus(contextId)}
      ref={scrollRef}
    >
        <h2>{props.listId}</h2>
        <div ref={containerRef}>
          <For each={liveList.signal()}>
            {(item, index) => (
              <Item
                item={item}
                listIndex={index()}
                selection={selection}
              />
            )}
          </For>
        </div>
    </section>
  );
}
