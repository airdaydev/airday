import {
  on, createSignal, For, onCleanup, onMount,
  createEffect,
} from 'solid-js';
import TodoSVG from '../icons/todo.svg';
import XSVG from '../icons/x.svg';
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
  let scrollRef: HTMLDivElement;
  const liveList = openList(props.listId);
  if (!liveList) throw new Error('List not found');
  const selection = new AcmeReactiveSelection();
  let placeholderRef: HTMLElement | undefined;
  // PoC: Placeholder behaviour outside solid
  // Not a great solution bc may not reconcile well
  // createEffect((prev) => {
  //   // TODO: Includes liveList as an explicit dependent, so it recalculates to list changes
  //   // TODO: Will the For reconcile loop be unhappy?
  //   const index = selection.lastTouchedIndex();
  //   const isDragging = selection.isDragging();
  //   console.log('start-effect', index);
  //   if (typeof index !== 'number' || !isDragging) {
  //     if (placeholderRef) {
  //       placeholderRef.remove()
  //     }
  //     return;
  //   }
  //   if (placeholderRef) {
  //     placeholderRef.remove()
  //   }
  //   placeholderRef = document.createElement('div');
  //   placeholderRef.innerText = 'whatever';
  //   placeholderRef.style.height = '4em';
  //   placeholderRef.style.background = '#ccc';
  //   scrollRef?.insertBefore(placeholderRef, scrollRef.childNodes[index + 1]);
  // });
  // TODO: Incorporate into handler and wire up to top level keyboard module
  const contextId = nanoid();
  onMount(() => {
    keyboardShortcuts.registerHandler('keydown', contextId, getListKeyboardHandler({
      liveList,
      selection,
      scrollRef,
    }));
  });
  onCleanup(() => {
    keyboardShortcuts.unregisterHandler('keydown', contextId)
    console.log(`cleaning up list ${props.listId}`)
  });

  // TODO: First attempt to do in-list dragging
  // A reactive means of handling list & placeholder changes on drag
  // TBH: An explicitly set means of doing this COULD be a little cleaner.
  // This is better off being created from the liveList which can take a selection module.
  const [instanceSignal, setInstanceSignal] = createSignal<AcmeItem[]>(liveList.signal());
  const unsubscribe = createEffect(on([selection.globalIsDragging, selection.lastTouchedIndex, liveList.signal], () => {
    console.log('on');
    setInstanceSignal(liveList.signal());
    // if (typeof selection.lastTouchedIndex() === 'number') {
    //   // We have a placeholder location
      // 
    // }
    if (selection.globalIsDragging()) {
      // We are dragging, so filter if this is our list
      // TODO: This is not known on first drag!
      // const isDraggingLocal = selection.lastTouchedIndex();
      // console.log('selection.isDragging()', isDraggingLocal)
      const filtered = liveList.signal().filter((val) => !selection.keys.has(val.id));
      // placeholder
      const lastTouchedIndex = selection.lastTouchedIndex();
      if (typeof lastTouchedIndex === 'number') {
        filtered.splice(lastTouchedIndex, 1, { id: 'yo', text: 'placeholder' }, filtered[lastTouchedIndex])
      }
      setInstanceSignal(filtered);
    } else {
      setInstanceSignal(liveList.signal())
    }
  }));
  
  return (
    <section
      class={styles.list}
      tabIndex={props.tabId}
      onFocus={() => keyboardShortcuts.setFocus(contextId)}
      onMouseLeave={(() => selection.setLastTouchedIndex(false))}
    >
      <div class={styles['list-header']}>
        <div style={`display: flex; align-items: center;`}>
          <TodoSVG style={`margin: 0.5em;`} />
          <h2 style={`margin: 0.5em 0;`}>{props.listId}</h2>
        </div>
        <XSVG />
      </div>
      <div ref={scrollRef} class={styles['list-scroll']}>
        {/* <For each={selection.isDragging() ? liveList.signal().filter((value) => !selection.keys.has(value.id)) : liveList.signal()}> */}
        <For each={instanceSignal()}>
          {(item, index) => (
            <Item
              item={item}
              listIndex={index()}
              selection={selection}
              liveList={liveList}
              scrollRef={scrollRef}
            />
          )}
        </For>
      </div>
    </section>
  );
}
