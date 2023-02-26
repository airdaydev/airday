import { createSignal, createEffect, onCleanup } from 'solid-js';
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
                'dragging': isInDragSet(),
            }}
            class={styles['item-container']}
            style={`
                ${selected() && `background: #ccc;`};
            `}
            ref={containerRef}
            onMouseDown={(event: MouseEvent) => {
                if (event.metaKey) {
                    props.selection.toggleKey(props.item.id);
                    return;
                }
                if (!event.shiftKey) {
                    console.log('loading event handlers');
                    const origin: [number, number] = [event.clientX, event.clientY];
                    const mouseMove = (mouseUpEvent: MouseEvent) => {
                        // Make moving a little more effort to avoid slips
                        if (distance(origin, [mouseUpEvent.clientX, mouseUpEvent.clientY]) > 3) {
                            props.selection.setDragging(true);
                            console.log('we draggin');
                        }
                    };
                    window.addEventListener('mousemove', mouseMove);
                    window.addEventListener('mouseup', () => {
                        console.log('mouse up!');
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
            <div class={styles['item-edit']} onClick={(prev) => setEdit(true)}>
                {props.listIndex} {props.item.text}
            </div>
        </div>
    )
}
