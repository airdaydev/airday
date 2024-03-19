import {
  on, createSignal, For, onCleanup, onMount,
  createEffect,
  useContext,
} from 'solid-js';
import { AcmeReactiveSelection, dragOriginSelection, globalLastDisplayIndex } from '../list/selection.js';
import styles from './list.module.css';
import { Item } from './item';
import { dragOriginList } from '../store/fast-list.js';
import { keyboardShortcuts } from '../keyboard.js';
import { getListKeyboardHandler } from './keyboard-handler.js';
import { ListHeader } from './list-header.jsx';
import { viewState } from '../view-state';
import { Placeholder } from './placeholder';
import { DragStack } from './drag-stack';
import { sessionContext } from '../store/context.js';

interface ListProps {
  view: BordeView;
  tabId: number;
}

type DisplayList = (string | { type: 'placeholder' })[];

// Challenge, index tracking without refreshing the list

/**
 * An ordered list supporting inter-list drag & drop
 * @param props 
 * @returns 
 */
export function List(props: ListProps) {
  const session = useContext(sessionContext);
  let scrollRef: HTMLDivElement;
  let fastList = session.workspace.openFastList(props.view);
  const container = session.workspace.containerModel.index.get(props.view.containerId);
  if (!fastList) {
    return <div>{props.view.type}</div>
  }
  const selection = new AcmeReactiveSelection();
  // A reactive means of handling list & placeholder changes on drag
  // TBH: An explicitly set means of doing this COULD be a little cleaner.
  // This is better off being created from the fastList which can take a selection module.
  const [displayList, setDisplayList] = createSignal<DisplayList>(fastList.signal[0]());
  // TODO: Desub on unmount
  const unsubscribe = createEffect(on([selection.globalIsDragging, selection.lastTouchedIndex, fastList.signal[0]], () => {
    if (selection.globalIsDragging()) {
      // We are dragging, so filter if this is our list instance
      let filtered: DisplayList = [...fastList.signal[0]()];
      if (dragOriginSelection === selection) {
        filtered = filtered.filter((val) => !selection.keys.has(val))
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
      const noFilter = [...fastList.signal[0]()];
      // Deal with list empty case
      // Deal with list empty and drag onto list case
      setDisplayList(noFilter);
    }
  }));
  /**
   * Handles drops from same or foreign display list, necessary on all lists
   */
  function handleDrop() {
    viewState.setActiveViewId(props.view.id);
    const ltIndex = globalLastDisplayIndex;
    const dl = displayList();
    if (selection.globalIsDragging() && typeof ltIndex === 'number' && dragOriginSelection && dragOriginList) {
      // TODO: A map between displayList and fastlist might be beneficial
      const beforeIndex = ltIndex - 1;
      const afterIndex = Math.min(dl.length, ltIndex + 1);
      const beforeId = dl[beforeIndex] ? dl[beforeIndex] : null;
      const afterId = dl[afterIndex] ? dl[afterIndex] : null;
      fastList?.moveItems(dragOriginSelection.keys, dragOriginList, [beforeId || null, afterId || null]);
      if (dragOriginSelection !== selection) {
        selection.clear();
        selection.addKeys(Array.from(dragOriginSelection.keys));
        dragOriginSelection.clear();
      }
    }
  }
  onMount(() => {
    keyboardShortcuts.registerHandler('keydown', props.view.id, getListKeyboardHandler({
      fastList,
      selection,
      scrollRef,
    }));
  });
  onCleanup(() => {
    keyboardShortcuts.unregisterHandler('keydown', props.view.id);
  });
  
  return (
    <>
      {selection.isDragging() && <DragStack size={selection.keys.size} />}
      <section
        classList={{
          [styles.list]: true,
          [styles.active]: viewState.activeViewId() === props.view.id,
        }}
        tabIndex={props.tabId}
        onFocus={() => { viewState.setActiveViewId(props.view.id) }}
        onClick={() => { viewState.setActiveViewId(props.view.id) }}
        onMouseLeave={(() => selection.setLastTouchedIndex(false))}
        onMouseUp={handleDrop}
      >
        {container && <ListHeader tabId={props.tabId} container={container} />}
        <div
          ref={scrollRef}
          class={styles['list-scroll']}
          onMouseEnter={(event) => {
            const target = event.target;
            // Are we in the blank space below all items?
            // TODO: Or are there 0 items?
            const lastChild = target.lastElementChild;
            if (!lastChild) return;
            const bbox = lastChild.getBoundingClientRect();
            if (event.clientY > bbox.bottom) {
              selection.setLastTouchedIndex(displayList().length)
            }
          }}
        >
          {displayList().length ? (
            <For each={displayList()}>
              {(item, index) => (
                <>
                  {(item as any).type === 'placeholder' && (
                    <Placeholder listIndex={index()} selection={selection} />
                  )}
                  {typeof (item as any) === 'string' && (
                    <Item
                      item={fastList.getItem(item)}
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
          ) : (
            <div class={styles['blank-list']} onMouseOver={() => selection.setLastTouchedIndex(0)}>
              To add a new item, press <span>⌘+n</span>.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
