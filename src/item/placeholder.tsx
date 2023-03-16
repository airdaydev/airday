import { AcmeReactiveSelection } from '../list/selection';
import styles from './item.module.css';

interface PlaceholderProps {
    listIndex: number;
    selection: AcmeReactiveSelection;
}

export function Placeholder(props: PlaceholderProps) {
    let containerRef: HTMLDivElement | undefined;
    return (
        <div
            classList={{
                [styles['item-container']]: true,
            }}
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
