import { createSignal } from 'solid-js';
import { AccountContextMenu } from './context-menus';
import styles from './header.module.css';
import Caret from '../icons/caret.svg?component-solid';

export const AccountButton = () => {
  let buttonRef: HTMLButtonElement | undefined;
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>([0, 0]);
  function openContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (buttonRef) {
      const bounds = buttonRef.getBoundingClientRect();
      setCtxOffset([bounds.right, bounds.bottom]);
      setCtxOpen(true);
    }
  }
  return (
    <button
    class={`${styles['workspace-button']} ${styles['nav-button']}`}
    onClick={(event) => {
      console.log('onclick button')
      openContextMenu(event)
    }}
    ref={buttonRef}
    >
      {ctxOpen() && (
        <AccountContextMenu
          close={() => setCtxOpen(false)}
          offset={ctxOffset()}
        />
      )}
      <span style="padding-right: 0.25em;">Daniel</span>
      <Caret style="stroke-width: 1.25px; width: 0.75em; height: 0.75em;" />
    </button>
  );
}
