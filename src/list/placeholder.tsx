import { AcmeReactiveSelection } from '../list/selection';
import styles from './list.module.css';

interface PlaceholderProps {
    listIndex: number;
    selection: AcmeReactiveSelection;
    noBg: true;
}

export function Placeholder(props: PlaceholderProps) {
    let containerRef: HTMLDivElement | undefined;
    return (
        <div
            class={styles['placeholder']}
            style={`${props.noBg && 'background: none;'}`}
            ref={containerRef}
            onMouseEnter={(event: MouseEvent) => {
                props.selection.setLastTouchedIndex(props.listIndex);
            }}
        >
            <div style={`color: #ccc;`}>
                <span>#{props.listIndex}</span>
            </div>
        </div>
    )
}
