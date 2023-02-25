import { createSignal, createEffect, onCleanup } from 'solid-js';
import { AcmeReactiveSelection } from '../list/selection';
import { store } from '../store/main';
import { LiveList } from '../store/open-list';
import styles from './item.module.css';

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
    return (
        <div
            style={`${selected() && `background: #ccc;`}`}
            ref={containerRef}
            onClick={(event: MouseEvent) => {
                if (!event.shiftKey) {
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
                        console.log('below!');
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
