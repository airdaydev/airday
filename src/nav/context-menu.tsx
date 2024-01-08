import { Accessor, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { viewState } from "../view-state";

interface NavItemContextMenu {
    close: () => void;
    container: Accessor<BordeContainer>;
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
    // TODO: Show context menu div
    onCleanup(() => {
      window.removeEventListener('mousedown', clickOutside)
      // TODO: Hide context menu div
    })
    return (
      <Portal mount={document.getElementById('context-menu')}>
        <div
            ref={containerRef}
            style={`
                position: absolute;
                z-index: 10;
                display: flex;
                flex-direction: column;
                background: var(--light-shade);
                border-radius: 3px;
                box-shadow: 1px 1px 2px #0000002e;
                padding: 0.25em;
                left: ${props.offset()[0]}px;
                top: ${props.offset()[1]}px;
            `}
            tabIndex={0}
        >
            <button onClick={() => {
                viewState.addContainerView(props.container().id);
                props.close();
            }}>
                <span>Open in new view</span>
            </button>
            <button disabled>
                <span>Export</span>
            </button>
            <button disabled>
                <span>Delete</span>
            </button>
        </div>
      </Portal>
    )
}
