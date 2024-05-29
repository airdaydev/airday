import {
    createSignal, createEffect, onCleanup, on, Accessor,
    onMount,
    Signal,
} from 'solid-js';
import { AcmeReactiveSelection } from './selection';
import { KeyboardShortcuts } from '../keyboard';
import { FastList } from '../store/fast-list';
import styles from './list.module.css';
import { distance, moveCaretToPosition } from './utils';
import { Checkbox } from './checkbox';
import { ContextMenu } from '../context-menu/context-menu';
import { Sticker } from '../stickers/main';
import Triangle from '../stickers/baseline/triangle.svg?component-solid';
import CircleAqua from '../stickers/baseline/circle-aqua.svg?component-solid';
import Smiley from '../stickers/baseline/smiley.svg?component-solid';
import { elapsedString } from '../generic/date';

interface ItemContextMenuProps {
  close: () => void;
  item: Accessor<BordeItem>,
  updateSticker: (sticker: string) => void;
  style: string;
  offset: [number, number];
}

export function ItemContextMenu(props: ItemContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      style={props.style}
      offset={props.offset}
    >
      <button disabled>
        <span>Add to up next</span>
      </button>
      <button disabled>
        <span>Focus</span>
      </button>
      <hr />
      <button disabled>
        <span>Copy text</span>
      </button>
      <button disabled>
        <span>Copy as JSON</span>
      </button>
      <button disabled>
        <span>Copy as Markdown</span>
      </button>
      <hr />
      <div>
        <button onClick={() => props.updateSticker('smiley')}>
          <Smiley />
        </button>
        <button  onClick={() => props.updateSticker('triangle')}>
          <Triangle />
        </button>
        <button onClick={() => props.updateSticker('circleAqua')}>
          <CircleAqua />
        </button>
        <button onClick={() => props.updateSticker(null)}>X</button>
      </div>
      <hr />
      <button disabled>
        <span>Duplicate</span>
      </button>
      <button disabled>
        <span>Delete</span>
      </button>
    </ContextMenu>
  )
}

interface ItemProps {
    listIndex: number;
    item: Signal<BordeItem>;
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
    const item = props.item[0]();
    const [edit, setEdit] = createSignal(false);
    const [caretPos, setCaretPos] = createSignal(0);
    const [selected, unsubscribe] = props.selection.getSignalByKey(item.id);
    // ContextMenu
    const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
    const [ctxOffset, setCtxOffset] = createSignal<[number, number]>();
    function openContextMenu(event: MouseEvent) {
      // TODO: Prevent shift key + context menu (too much work)
      event.preventDefault();
      if (event.target) {
        setCtxOffset([event.clientX, event.clientY]);
      }
      setCtxOpen(true);
      onClick(event);
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
            props.fastList.updateItemContents(item.id, { text: textAreaRef.value });
            // props.fastList.updateItemConten(item.id, { open: false })
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
        if (item.open === true) {
            enterEditMode();
        }
    })
    const onClick = (event: MouseEvent) => {
      event.preventDefault(); // prevents selection on Safari
      // if (event.button === 2) {
      //   openContextMenu(event);
      // }; // context click behaviour
      if (event.metaKey) {
          props.selection.toggleKey(item.id);
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
          if (props.selection.keys.has(item.id)) {
              // If we click on an already selected item, do nothing until mouse up
              // Bc this is the start of a drag
              // on mouse up, unselect if no drag
              return;
          }
          props.selection.selectOne(item.id)
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
    }
    return (
        <>
            {edit() && (
                <div
                    ref={editContainer}
                    onKeyDown={editModeKeyboardHandler}
                    class={styles['edit-container']}
              >
                <Checkbox
                    onChange={(event: InputEvent) => props.fastList.completeItem(item.id, event.target?.checked ? new Date() : null)}
                    checked={!!item.tsCompleted}
                />
                <div
                  ref={dummyRef}
                  class={styles['dummy-ref']}
                />
                <textarea
                  ref={textAreaRef}
                  value={item.text}
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
                  id={`container-${item.id}`}
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
                    onMouseDown={onClick}
                >
                  <div class={styles[`item-content-box`]}>
                    <Checkbox
                      onChange={(event: InputEvent) => props.fastList.completeItem(item.id, event.target?.checked ? new Date() : null)}
                      checked={!!item.tsCompleted}
                    />
                    <div>
                      <div style={`white-space: pre-line; max-width: 48em;`}>
                        {props.item[0]().text}
                      </div>
                      {props.item[0]().sticker && (
                        <div class={styles['meta-line']}>
                          {props.item[0]().sticker && (
                            <Sticker
                              set="baseline"
                              item={props.item}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
            )}
            {ctxOpen() && (
              <ItemContextMenu
                close={() => setCtxOpen(false)}
                item={item}
                offset={ctxOffset()}
                updateSticker={(sticker: string) => {
                  props.fastList.updateItemContents(item.id, { sticker });
                  setCtxOpen(false);
                }}
              />
            )}
        </>
    )
}
