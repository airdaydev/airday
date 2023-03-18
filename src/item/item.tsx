import { createSignal, createEffect, onCleanup, on, Accessor } from 'solid-js';
import { AcmeReactiveSelection, globalLastDisplayIndex } from '../list/selection';
import { KeyboardShortcuts } from '../keyboard';
import { store } from '../store/main';
import { FastList } from '../store/fast-list';
import styles from './item.module.css';
import { distance } from './utils';

function moveCaretToPosition(el: HTMLInputElement, index: number) {
    el.selectionStart = el.selectionEnd = index;
}

interface ItemProps {
    listIndex: number;
    item: AcmeItem;
    selection: AcmeReactiveSelection;
    fastList: FastList;
    scrollRef: HTMLElement;
    keyboardShortcuts: KeyboardShortcuts;
    displayList: Accessor<AcmeItem[]>; // TODO: OR NULL
}

export function Item(props: ItemProps) {
    let containerRef: HTMLDivElement | undefined;
    let dummyRef: HTMLDivElement | undefined;
    let textAreaRef: HTMLInputElement | undefined;
    const [edit, setEdit] = createSignal(false);
    const [caretPos, setCaretPos] = createSignal(0);
    const [selected, unsubscribe] = props.selection.getSignalByKey(props.item.id);
    function editModeKeyboardHandler(event: KeyboardEventInit) {
        if (event.key === 'Escape') {
            leaveEditMode(true);
        }
    }
    function enterEditMode() {
        props.keyboardShortcuts.disable();
        props.selection.clear();
        setEdit(true);
    }
    function leaveEditMode(save?: boolean) {
        if (save) {
            // optimistically update fastList, then idb
            props.fastList.updateItemContents(props.item.id, textAreaRef.value);
        }
        props.keyboardShortcuts.enable();
        setEdit(false);
    }
    onCleanup(() => unsubscribe());
    createEffect(on([edit], () => {
        if (textAreaRef && dummyRef) {
            textAreaRef.focus();
            moveCaretToPosition(textAreaRef, caretPos());
            dummyRef.textContent = textAreaRef.value;
        }
    }))
    const isInDragSet = () => props.selection.isDragging() && props.selection.keys.has(props.item.id);
    return (
        <>
            {edit() && (
                <div
                    onKeyDown={editModeKeyboardHandler}
                    style={`
                    min-height: 4em;
                    position: relative;
                    max-width: 44em;
                    box-sizing: border-box;
                    padding: 0.5em;
                    border-radius: 3px;
                    background: #e7ebff;
                    `}
              >
                <div
                  ref={dummyRef}
                  style={`
                    visibility: hidden;
                    white-space: pre-wrap;
                    word-break: break-word;
                    &::after {
                      content: "\A";
                    }
                  `}
                />
                <textarea
                  ref={textAreaRef}
                  value={props.item.text}
                  onInput={(event) => {
                    if (dummyRef) dummyRef.textContent = event.target.value;
                  }}
                  style={`
                      position: absolute;
                      resize: none;
                      width: 100%;
                      height: 100%;
                      box-sizing: border-box;
                      outline-style: none;
                      margin: 0;
                      padding: 0.5em;
                      left: 0;
                      right: 0;
                      top: 0;
                      bottom: 0;
                      background: none;
                      border: none;
                      font-size: 1em;
                      font-family: inherit;
                  `}
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
                        [styles['item-container-dragging']]: isInDragSet(),
                        [styles['item-container-selected']]: selected(),
                        [styles['item-container']]: true,
                    }}
                    ref={containerRef}
                    onMouseEnter={(event: MouseEvent) => {
                        props.selection.setLastTouchedIndex(props.listIndex);
                    }}
                    onMouseDown={(event: MouseEvent) => {
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
                            //     console.log('mouse up yo');
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
                    <div class={styles['item-check']}></div>
                    <div>
                        <div>{props.item.text}</div>
                        <div style={`color: #ccc;`}>
                            2m
                            <span>#{props.listIndex}</span>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
