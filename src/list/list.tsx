import {
  on, createSignal, For, onCleanup, onMount,
  createEffect,
} from 'solid-js';
import TodoSVG from '../icons/todo.svg';
import XSVG from '../icons/x.svg';
import { AcmeReactiveSelection, dragOriginSelection, globalLastDisplayIndex } from '../list/selection.js';
import styles from './list.module.css';
import { Item } from '../item/item';
import { store } from '../store/main';
import { dragOriginList, openList } from '../store/fast-list.js';
import { nanoid } from 'nanoid';
import { keyboardShortcuts } from '../keyboard.js';
import { getListKeyboardHandler } from './keyboard-handler.js';
import { closeView } from '../view-state';
import { Placeholder } from '../item/placeholder';

interface ListProps {
  listId: string;
  tabId: number;
}

type DisplayList = (AcmeItem | { type: 'placeholder' })[];

// const bigList = new Array(2000).fill(0).map((val, index, arr) => ({
//   id: index,
//   text: `yo-${index}`,
// }));

// Challenge, index tracking without refreshing the list

/**
 * An ordered list supporting inter-list drag & drop
 * @param props 
 * @returns 
 */
export function List(props: ListProps) {
  let scrollRef: HTMLDivElement;
  const fastList = openList(props.listId);
  if (!fastList) throw new Error('List not found');
  const selection = new AcmeReactiveSelection();
  const contextId = nanoid();
    // A reactive means of handling list & placeholder changes on drag
  // TBH: An explicitly set means of doing this COULD be a little cleaner.
  // This is better off being created from the fastList which can take a selection module.
  const [displayList, setDisplayList] = createSignal<DisplayList>(fastList.signal());
  // TODO: Desub on unmount
  const unsubscribe = createEffect(on([selection.globalIsDragging, selection.lastTouchedIndex, fastList.signal], () => {
    if (selection.globalIsDragging()) {
      // We are dragging, so filter if this is our list instance
      let filtered: DisplayList = [...fastList.signal()];
      if (dragOriginSelection === selection) {
        filtered = filtered.filter((val) => !selection.keys.has(val.id))
      }
      // dragOriginSelection
      // placeholder
      const lastTouchedIndex = selection.lastTouchedIndex();
      if (typeof lastTouchedIndex === 'number') {
        // TODO: Use a null val here for placeholder (or type: placeholder)
        filtered.splice(lastTouchedIndex, 0, { type: 'placeholder' })
      }
      setDisplayList(filtered);
    } else {
      setDisplayList(fastList.signal())
    }
  }));
  /**
   * Handles drops from same or foreign display list
   */
  function handleDrop() {
    const ltIndex = globalLastDisplayIndex;
    const dl = displayList();
    if (selection.globalIsDragging() && typeof ltIndex === 'number' && dragOriginSelection && dragOriginList) {
      // TODO: A map between displayList and fastlist might be beneficial
      const beforeIndex = ltIndex - 1;
      const afterIndex = Math.min(dl.length, ltIndex + 1);
      const beforeId = dl[beforeIndex] ? dl[beforeIndex] : null;
      const afterId = dl[afterIndex] ? dl[afterIndex] : null;
      fastList?.moveItems(dragOriginSelection.keys, dragOriginList, [beforeId?.id || null, afterId?.text || null]);
      if (dragOriginSelection !== selection) {
        selection.clear();
        selection.addKeys(Array.from(dragOriginSelection.keys));
        dragOriginSelection.clear();
      }
    }
  }
  onMount(() => {
    keyboardShortcuts.registerHandler('keydown', contextId, getListKeyboardHandler({
      fastList,
      selection,
      scrollRef,
    }));
  });
  onCleanup(() => {
    keyboardShortcuts.unregisterHandler('keydown', contextId)
  });
  
  return (
    <section
      class={styles.list}
      tabIndex={props.tabId}
      onFocus={() => keyboardShortcuts.setFocus(contextId)}
      onMouseLeave={(() => selection.setLastTouchedIndex(false))}
      onMouseUp={handleDrop}
    >
      <div class={styles['list-header']}>
        <div style={`display: flex; align-items: center;`}>
          <TodoSVG style={`margin: 0.5em;`} />
          <h2 style={`margin: 0.5em 0;`}>{props.listId}</h2>
        </div>
        <button
          onClick={() => closeView(props.tabId)}
          style={`border: none; background: none; cursor: pointer;`}
        >
          <XSVG />
        </button>
      </div>
      <div ref={scrollRef} class={styles['list-scroll']}>
        <For each={displayList()}>
          {(item, index) => (
            <>
              {item.type === 'placeholder' && (
                <Placeholder listIndex={index()} selection={selection} />
              )}
              {item.id && (
                <Item
                  item={item}
                  listIndex={index()}
                  selection={selection}
                  fastList={fastList}
                  displayList={displayList}
                  scrollRef={scrollRef}
                  keyboardShortcuts={keyboardShortcuts}
                />
              )}
            </>
          )}
        </For>
      </div>
    </section>
  );
}
