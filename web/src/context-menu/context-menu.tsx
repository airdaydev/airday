import { createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import styles from './context-menu.module.css';

interface ContextMenuProps {
    close: () => void;
    children: any;
    anchorRef?: HTMLElement;
    offset?: [number, number];
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
      let styleString = '';
      if (props.offset[0] + containerRef?.getBoundingClientRect().width > document.body.scrollWidth) {
        styleString += `right: ${document.body.clientWidth - props.offset[0]}px;`;
      } else {
        styleString += `left: ${props.offset[0]}px;`;
      }
      if (props.offset[1] + containerRef?.getBoundingClientRect().height > document.body.scrollHeight) {
        styleString += `bottom: 0px;`;
      } else {
        styleString += `top: ${props.offset[1]}px;`;
      }
      style[1](styleString);
    }
    window.addEventListener('resize', props.close);
  });
  onCleanup(() => window.removeEventListener('resize', props.close));
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
