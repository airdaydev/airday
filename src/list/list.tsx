import {
  createResource, createSignal, For, onCleanup,
} from 'solid-js';
import { AcmeReactiveSelection } from '../list/selection.js';
import styles from './list.module.css';
import { Item } from '../item/item';
import { store } from '../store/main';
import { openList } from '../store/open-list.js';
import { nanoid } from 'nanoid';
import { keyboardShortcuts } from '../keyboard.js';
import { jumpToElIfOutsideView } from './utils.js';

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
  keyboardShortcuts.registerHandler('keydown', contextId, (event: KeyboardEvent) => {
    const list = liveList.signal();
    if (event.key === 'Escape') {
      event.preventDefault();
      selection.clear();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (event.altKey) {
        if (!list.length) return;
        selection.selectOne(list[list.length - 1].id);
        jumpToElIfOutsideView(scrollRef, containerRef.childNodes[list.length - 1])
      }
      // - on key down, select next down from last selected, set last selected, origin
      if (!selection.lastKeySelected) {
        const neighbour = list[0];
        if (neighbour) selection.selectOne(neighbour.id);
        return;
      }
      if (selection.lastKeySelected && !event.shiftKey) {
        const neighbour = liveList.getNeighbourIndex(selection.lastKeySelected);
        if (neighbour) {
          selection.selectOne(list[neighbour].id);
          jumpToElIfOutsideView(scrollRef, containerRef.childNodes[neighbour])
        }
      }
      if (selection.rangeOrigin && event.shiftKey) {
        // contiguous area below origin, continue:
        const origin = liveList.getIndexOfKey(selection.rangeOrigin);
        if (origin === false) return;
        // Check if items above
        const prevIndex = liveList.getNextNotInSet(origin, selection.keys, 'prev');
        if (prevIndex === origin - 1  || origin === 0) {
          // select down
          const index = liveList.getNextNotInSet(origin, selection.keys);
          if (index !== false) {
            selection.addKey(list[index].id);
            jumpToElIfOutsideView(scrollRef, containerRef.childNodes[index])
          }
        } else {
          // deselect down
          selection.removeKey(prevIndex !== false ? list[prevIndex + 1].id : list[0].id);
        }
        return;
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.altKey) {
        if (!list.length) return;
        selection.selectOne(list[0].id);
        jumpToElIfOutsideView(scrollRef, containerRef.childNodes[0])
      }
      // - on key up, select next down from last selected, set last selected, origin
      if (!selection.lastKeySelected) {
        const neighbour = list[list.length - 1];
        if (neighbour) selection.selectOne(neighbour.id);
        return;
      }
      if (selection.lastKeySelected && !event.shiftKey) {
        const neighbour = liveList.getNeighbourIndex(selection.lastKeySelected, 'prev');
        if (neighbour !== false) {
          selection.selectOne(liveList.signal()[neighbour].id);
          jumpToElIfOutsideView(scrollRef, containerRef.childNodes[neighbour]);
        }
      }
      if (selection.rangeOrigin && event.shiftKey) {
        // contiguous area below origin, continue:
        const origin = liveList.getIndexOfKey(selection.rangeOrigin);
        if (origin === false) return;
        // Check if items below
        const nextIndex = liveList.getNextNotInSet(origin, selection.keys, 'next');
        if (nextIndex === origin + 1 || origin === list.length - 1) {
          // select up
          const index = liveList.getNextNotInSet(origin, selection.keys, 'prev');
          if (index !== false) {
            selection.addKey(list[index].id);
            jumpToElIfOutsideView(scrollRef, containerRef.childNodes[index]);
          }
        } else {
          // deselect up
          selection.removeKey(nextIndex !== false ? list[nextIndex - 1].id : list[list.length - 1].id);
          return;
        }
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
