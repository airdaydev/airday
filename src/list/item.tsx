import {
    createSignal, createEffect, onCleanup, on, Accessor,
    onMount,
} from 'solid-js';
import { AcmeReactiveSelection, globalLastDisplayIndex } from './selection';
import { KeyboardShortcuts } from '../keyboard';
import { store } from '../store/main';
import { FastList } from '../store/fast-list';
import styles from './list.module.css';
import { distance, moveCaretToPosition } from './utils';
import { Checkbox } from './checkbox';
import { ContextMenu } from '../context-menu/context-menu';
import { Sticker } from '../stickers/main';
import { elapsedString } from '../generic/date';

interface ItemContextMenuProps {
  close: () => void;
  item: Accessor<BordeItem>,
  offset: Accessor<[number, number]>;
}

export function ItemContextMenu(props: ItemContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      offset={props.offset}
    >
      <button disabled>
        <span>Duplicate</span>
      </button>
      <button disabled>
        <span>Focus</span>
      </button>
      <button disabled>
        <span>Delete</span>
      </button>
    </ContextMenu>
  )
}

interface ItemProps {
    listIndex: number;
    item: BordeItem;
    selection: AcmeReactiveSelection;
    fastList: FastList;
    scrollRef: HTMLElement;
    keyboardShortcuts: KeyboardShortcuts;
    displayList: Accessor<BordeItem[]>; // TODO: OR NULL
}

export function Item(props: ItemProps) {
    let editContainer: HTMLDivElement | undefined;
    let containerRef: HTMLDivElement | undefined;
    let dummyRef: HTMLDivElement | undefined;
    let textAreaRef: HTMLInputElement | undefined;
    const [edit, setEdit] = createSignal(false);
    const [caretPos, setCaretPos] = createSignal(0);
    const [selected, unsubscribe] = props.selection.getSignalByKey(props.item.id);
    // ContextMenu
    const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
    const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
    function openContextMenu(event: MouseEvent) {
      event.preventDefault();
      setCtxOffset([event.clientX, event.clientY]);
      setCtxOpen(true);
    }
    function editModeKeyboardHandler(event: KeyboardEventInit) {
        if (event.key === 'Enter' && !event.shiftKey) {
            leaveEditMode(true);
            return;
        }
        if (event.key === 'Escape') {
            leaveEditMode(true);
            return;
        }
    }
    const clickOutside = (event: MouseEvent) => {
        if (!editContainer?.contains(event.target)) {
            leaveEditMode(true);
        }
    }
    function enterEditMode() {
        props.keyboardShortcuts.disable();
        props.selection.clear();
        setEdit(true);
        window.addEventListener('mousedown', clickOutside);
    }
    function leaveEditMode(save?: boolean) {
        // Delete if new item
        if (save) {
            // optimistically update fastList, then idb
            props.fastList.updateItemContents(props.item.id, { text: textAreaRef.value });
            props.fastList.updateItem(props.item.id, { open: false })
        }
        props.keyboardShortcuts.enable();
        setEdit(false);
        window.removeEventListener('mousedown', clickOutside)
    }
    
    /**
     * Creates rounded corners arounded contiguous selection boundary
     */
    function getSelectClasses() {
        const classes: Record<string, boolean> = {
            [styles['selected']]: selected(),
        };
        if (!props.selection.keys.has(props.displayList()[props.listIndex - 1]?.id)) {
            classes[styles['selected-first']] = true;
        }
        if (!props.selection.keys.has(props.displayList()[props.listIndex + 1]?.id)) {
            classes[styles['selected-last']] = true;
        }
        return classes;
    }
    onCleanup(() => unsubscribe());
    createEffect(on([edit], () => {
        if (textAreaRef && dummyRef) {
            textAreaRef.focus();
            moveCaretToPosition(textAreaRef, caretPos());
            dummyRef.textContent = textAreaRef.value;
        }
    }))
    onMount(() => {
        if (props.item.open === true) {
            enterEditMode();
        }
    })
    return (
        <>
            {edit() && (
                <div
                    ref={editContainer}
                    onKeyDown={editModeKeyboardHandler}
                    class={styles['edit-container']}
              >
                <Checkbox
                    onChange={(event: InputEvent) => props.fastList.completeItem(props.item.id, event.target?.checked ? new Date() : null)}
                    checked={!!props.item.tsCompleted}
                />
                <div
                  ref={dummyRef}
                  class={styles['dummy-ref']}
                />
                <textarea
                  ref={textAreaRef}
                  value={props.item.text}
                  onInput={(event) => {
                    if (dummyRef) dummyRef.textContent = event.target.value;
                  }}
                  class={styles['text-area']}
                  onBlur={(event) => {
                    // TODO, not enough, check if external click with contains with ref
                    leaveEditMode(true);
                  }}
              />
              </div>
            )}
            {!edit() && (
                <div
                    onDblClick={(prev) => {
                        // Firefox
                        let position = 0;
                        if (typeof document.caretPositionFromPoint === 'function') {
                        position = document.caretPositionFromPoint(event.clientX, event.clientY).offset;
                        }
                        // TODO: caretRangeFromPoint(x, y) for other browsers
                        setCaretPos(position);
                        props.selection.clear();
                        enterEditMode();
                    }}
                    // https://www.solidjs.com/docs/latest/api#classlist
                    classList={{
                        [styles['item']]: true,
                        ...(selected()) && { ...getSelectClasses() },
                    }}
                    ref={containerRef}
                    onMouseEnter={(event: MouseEvent) => {
                        props.selection.setLastTouchedIndex(props.listIndex);
                    }}
                    onContextMenu={openContextMenu}
                    onMouseDown={(event: MouseEvent) => {
                        if (event.button === 2) return; // context click behaviour
                        event.preventDefault(); // prevents selection on Safari
                        if (event.metaKey) {
                            props.selection.toggleKey(props.item.id);
                            return;
                        }
                        if (!event.shiftKey) {
                            const origin: [number, number] = [event.clientX, event.clientY];
                            const mouseMove = (mouseUpEvent: MouseEvent) => {
                                event.preventDefault();
                                // Make moving a little more effort to avoid slips
                                if (distance(origin, [mouseUpEvent.clientX, mouseUpEvent.clientY]) > 3) {
                                    // props.selection.setLastTouchedIndex(props.listIndex);
                                    props.selection.setDragging(true);
                                    props.fastList.setDragOriginList(props.fastList.listId);
                                    // TODO: FILTER THE ACTIVE SELECTION
                                }
                                // Track where on list to place placeholder
                                // On blur, remove placeholder
                                // On 
                            };
                            window.addEventListener('mousemove', mouseMove);
                            window.addEventListener('mouseup', () => {
                            //     // TODO: Add drop zone event here
                            //     window.dispatchEvent(new Event('acme-drop-items'));
                                props.selection.setLastTouchedIndex(false);
                                props.selection.setDragging(false);
                                window.removeEventListener('mousemove', mouseMove);
                            }, { once: true })
                            if (props.selection.keys.has(props.item.id)) {
                                // If we click on an already selected item, do nothing until mouse up
                                // Bc this is the start of a drag
                                // on mouse up, unselect if no drag
                                return;
                            }
                            props.selection.selectOne(props.item.id)
                            return;
                        }
                        // TODO: Shift key but nothing selected
                        if (event.shiftKey && props.selection.keys.size) {
                            event.preventDefault();
                            // We can (almost) guarantee this bc selection has a size
                            const firstSelectedIndex = props.fastList.getFirstIndexOfSet(props.selection.keys);
                            if (firstSelectedIndex === false) return;
                            if (props.listIndex < firstSelectedIndex) {
                                const lastIndex = props.fastList.getLastIndexOfSet(props.selection.keys);
                                if (!lastIndex) return;
                                const keys = props.fastList.getKeysInRange(props.listIndex, lastIndex);
                                props.selection.clear();
                                props.selection.addKeys(keys);
                            } else {
                                const keys = props.fastList.getKeysInRange(firstSelectedIndex, props.listIndex);
                                props.selection.clear();
                                props.selection.addKeys(keys);
                            }
                        }
                    }}
                >
                  <div class={styles[`item-content-box`]}>
                    <Checkbox
                      onChange={(event: InputEvent) => props.fastList.completeItem(props.item.id, event.target?.checked ? new Date() : null)}
                      checked={!!props.item.tsCompleted}
                    />
                    <div>
                      <div style={`white-space: pre-line; max-width: 48em;`}>
                        {props.item.text}
                      </div>
                      <div class={styles['meta-line']}>
                        {props.item.sticker && (
                          <Sticker
                          set="baseline"
                          name={props.item.sticker}
                          />
                        )}
                        <span>Updated {elapsedString(props.item.tsCreated)}</span>
                      </div>
                    </div>
                  </div>
                </div>
            )}
            {ctxOpen() && (
              <ItemContextMenu
                close={() => setCtxOpen(false)}
                item={props.item}
                offset={ctxOffset}
              />
            )}
        </>
    )
}
