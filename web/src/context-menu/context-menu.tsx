import { createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import styles from './context-menu.module.css';

interface ContextMenuProps {
    close: () => void;
    children: any;
    anchorRef?: HTMLElement;
    offset?: [number, number];
}

function getDynamicPosition(anchor: HTMLElement, target: HTMLElement) {
  const anchorBounds = anchor.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  // Special condition: No target width
  if (anchorBounds.width === 0) {
    return 'opacity: 0;'
  }
  // Condition 1: Document width is less than target width (left-anchored); (bad experience)
  if (document.body.scrollWidth < targetBounds.width) {
    return `left: ${anchorBounds.left}px; top: ${anchorBounds.bottom}px;`;
  }
  // Condition 2: Target would go beyond document width, promptin right-anchor
  if (document.body.scrollWidth < targetBounds.width) {
    return `right: ${document.body.clientWidth - targetBounds.right}px; top: ${anchorBounds.bottom}px;`;
  }
  // Condition 3: Left-anchored
  return `left: ${anchorBounds.left}px; top: ${anchorBounds.bottom}px;`;
}

export function ContextMenu(props: ContextMenuProps) {
  let containerRef: HTMLDivElement | undefined;
  let style = createSignal('opacity: 0;');
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
  onMount(() => {
    if (props.offset && containerRef) {
      if (props.offset[0] + containerRef?.getBoundingClientRect().width > document.body.scrollWidth) {
        style[1](`right: ${document.body.clientWidth - props.offset[0]}px; top: ${props.offset[1]}px;`);
      } else {
        style[1](`left: ${props.offset[0]}px; top: ${props.offset[1]}px;`);
      }
    }
    // TODO: also setup window move listener
  });
  return (
    <Portal mount={document.getElementById('context-menu')}>
      <div
          ref={containerRef}
          class={styles['context-menu']}
          style={style[0]()}
          tabIndex={0}
      >
        {props.children}
      </div>
    </Portal>
  )
}
