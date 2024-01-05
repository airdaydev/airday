import { Signal } from 'solid-js';
import { viewState } from '../view-state';
import { EditableListTitle } from './list-title';
import styles from './list.module.css';
import TodoSVG from '../icons/nb-todo.svg';
import PlusSVG from '../icons/plus.svg';
import MoreSVG from '../icons/more-horizontal.svg';
import XSVG from '../icons/x.svg';

interface ListHeaderProps {
    container: Signal<AcmeContainer>;
    tabId: number;
}

export const ListHeader = (props: ListHeaderProps) => {
    return (
        <div class={styles['list-header']}>
            <div class={styles['list-header-internal']}>
            <div style={`display: flex; align-items: center;`}>
                <TodoSVG style={`margin: 0.5em;height: 1.75rem;width: 1.75rem;`} />
                <EditableListTitle container={props.container} />
            </div>
            <div>
                <button class={styles['list-button']}>
                <MoreSVG />
                </button>
                <button class={styles['list-button']}>
                <PlusSVG />
                </button>
                <button
                class={styles['list-button']}
                onClick={() => viewState.closeView(props.tabId)}
                >
                <XSVG />
                </button>
            </div>
            </div>
        </div>
    )
}