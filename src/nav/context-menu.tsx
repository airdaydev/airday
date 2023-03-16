import { Accessor, onCleanup } from "solid-js";
import { addView } from "../view-state";

interface NavItemContextMenu {
    close: () => void;
    list: AcmeList;
    offset: Accessor<[number, number]>;
}

export function NavItemContextMenu(props: NavItemContextMenu) {
    let containerRef: HTMLDivElement | undefined;
    const clickOutside = (event: MouseEvent) => {
        if (!containerRef?.contains(event.target)) {
            props.close();
        }
    }
    window.addEventListener('mousedown', clickOutside);
    onCleanup(() => window.removeEventListener('mousedown', clickOutside))
    console.log(props.offset())
    return (
        <div
            ref={containerRef}
            style={`
                position: absolute;
                z-index: 10;
                background: #f6f7fa;
                border-radius: 3px;
                box-shadow: 1px 1px 2px #0000002e;
                padding: 0.25em;
                width: 100%;
                left: ${props.offset()[0]}px;
                top: ${props.offset()[1]}px;
            `}
            tabIndex={0}
        >
            <button onClick={() => {
                addView(props.list.id);
                props.close();
            }}>
                <span>Open in new view</span>
            </button>
            <button disabled>
                <span>Rename</span>
            </button>
            <button disabled>
                <span>Delete</span>
            </button>
        </div>
    )
}