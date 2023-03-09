import { createSignal, createEffect, onCleanup, on } from 'solid-js';
import { AcmeReactiveSelection } from '../list/selection';
import { store } from '../store/main';
import { LiveList } from '../store/open-list';
import styles from './item.module.css';
import { distance } from './utils';

interface ItemProps {
    listIndex: number;
    item: AcmeItem;
    selection: AcmeReactiveSelection;
    liveList: LiveList;
    scrollRef: HTMLElement;
}

export function Item(props: ItemProps) {
    let containerRef: HTMLDivElement | undefined;
    const [edit, setEdit] = createSignal(false);
    const [selected, unsubscribe] = props.selection.getSignalByKey(props.item.id);
    onCleanup(() => unsubscribe());
    const isInDragSet = () => props.selection.isDragging() && props.selection.keys.has(props.item.id);
    return (
        <div
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
                            // TODO: FILTER THE ACTIVE SELECTION
                        }
                        // Track where on list to place placeholder
                        // On blur, remove placeholder
                        // On 
                    };
                    window.addEventListener('mousemove', mouseMove);
                    window.addEventListener('mouseup', () => {
                        // End drag
                        props.selection.setLastTouchedIndex(false);
                        props.selection.setDragging(false);
                        window.removeEventListener('mousemove', mouseMove);
                    }, { once: true })
                    if (props.selection.keys.has(props.item.id)) {
                        props.selection.setDragging(true);
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
                    const firstSelectedIndex = props.liveList.getFirstIndexOfSet(props.selection.keys);
                    if (firstSelectedIndex === false) return;
                    if (props.listIndex < firstSelectedIndex) {
                        const lastIndex = props.liveList.getLastIndexOfSet(props.selection.keys);
                        if (!lastIndex) return;
                        const keys = props.liveList.getKeysInRange(props.listIndex, lastIndex);
                        props.selection.clear();
                        props.selection.addKeys(keys);
                    } else {
                        const keys = props.liveList.getKeysInRange(firstSelectedIndex, props.listIndex);
                        props.selection.clear();
                        props.selection.addKeys(keys);
                    }
                }
            }}
        >
            <div classList={{
                // [styles['item-edit']]: true,,
            }} onClick={(prev) => setEdit(true)}>
                <div>{props.item.text}</div>
                <div>{props.listIndex}</div>
            </div>
        </div>
    )
}
