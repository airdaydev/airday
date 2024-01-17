import { Accessor, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { viewState } from "../view-state";
import styles from './context-menu.module.css';

interface ContextMenuProps {
    close: () => void;
    children: any;
    style: string;
}

export function ContextMenu(props: ContextMenuProps) {
    let containerRef: HTMLDivElement | undefined;
    const clickOutside = (event: MouseEvent) => {
        if (!containerRef?.contains(event.target)) {
            props.close();
        }
    }
    window.addEventListener('mousedown', clickOutside);
    const closeOneEsc = (event: KeyboardEvent) => {
      // TODO: Consider global keyboard handler
      if (event.key === 'Escape') {
        props.close();
      }
    };
    window.addEventListener('keydown', closeOneEsc);
    // TODO: Show context menu div
    onCleanup(() => {
      window.removeEventListener('mousedown', clickOutside)
      window.removeEventListener('keydown', closeOneEsc)
      // TODO: Hide context menu div
    });
    return (
      <Portal mount={document.getElementById('context-menu')}>
        <div
            ref={containerRef}
            class={styles['context-menu']}
            style={props.style}
            tabIndex={0}
        >
          {props.children}
        </div>
      </Portal>
    )
}

export const leftOffsetStyle = (offset: Accessor<[number, number]>) => `
  left: ${offset()[0]}px;
  top: ${offset()[1]}px;
`;

export const rightOffsetStyle = (offset: Accessor<[number, number]>) => `
  right: ${offset()[0]}px;
  top: ${offset()[1]}px;
`
