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
    createEffect(() => {
        // TODO: This needs to be moved to the list level, and item size will probs have to be computed & static
        // because currently many will trigger at once, but we will have to be specific about what gets triggered when
        // Lists will have to move independently!
        const isSelected = selected();
        if (isSelected && containerRef) {
            const bounding = containerRef.getBoundingClientRect();
            const viewportTop = window.scrollY;
            const viewportBottom = window.scrollY + window.innerHeight
            if (bounding.bottom > window.innerHeight) {
                console.log(bounding.bottom, window.scrollY)
                window.scrollTo(0, bounding.bottom + window.scrollY - window.innerHeight)
            }
            if (bounding.top < viewportTop) {
                console.log('do something!!')
            }
        }
    });
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
