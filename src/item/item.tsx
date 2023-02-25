import { createSignal, createEffect, onCleanup } from 'solid-js';
import { AcmeReactiveSelection } from '../list/selection';
import { store } from '../store/main';
import styles from './item.module.css';

interface ItemProps {
    listIndex: number;
    item: AcmeItem;
    selection: AcmeReactiveSelection;
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
            onClick={() => {
                console.debug(`Clicked ${JSON.stringify(props.item)}`)
                props.selection.selectOne(props.item.id)
            }}
        >
            <div class={styles['item-edit']} onClick={(prev) => setEdit(true)}>
                {props.listIndex} {props.item.text}
            </div>
        </div>
    )
}
