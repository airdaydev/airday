import { nanoid } from 'nanoid';
import { createSignal, createEffect, on } from 'solid-js';
import { keyboardShortcuts } from '../keyboard';
import { store } from '../store/main';
import { viewState } from '../view-state';
import styles from './nav.module.css';

/**
 * 2 stage add button
 * 1. Start input
 * 2. Finish input on enter
 */
export const AddListButton = () => {
    let inputRef: HTMLInputElement | undefined = undefined;
    const [editing, setEditing] = createSignal<boolean>(false);
    const leaveEditMode = (save: boolean) => {
        keyboardShortcuts.enable();
        if (save) {
            const id = nanoid();
            store.containerModel.insert({
                id,
                name: inputRef?.value || 'New list',
            });
            viewState.replaceActiveViewWithContainer(id);
        }
        setEditing(false);
    }
    const enterEditMode = () => {
        keyboardShortcuts.disable();
        setEditing(true);
    }
    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.code === 'Enter') {
            leaveEditMode(true);
        }
        if (event.code === 'Escape') {
            leaveEditMode(false);
        }
    }
    createEffect(on([editing], () => {
        if (inputRef) { inputRef.focus(); }
    }))
    // TODO: handle outside click
    return (
        <>
        {editing() ? (
            <input
                style='border: none; background: none; cursor: pointer; padding: 0.5em; outline: 0; font-family: inherit; font-size: 1rem;'
                type="text"
                placeholder="New list"
                ref={inputRef}
                onKeyDown={handleKeyDown}
            />
            ) : (
                <button
                class={styles['add-list-button']}
                onClick={() => enterEditMode()}
              >
                Add area
              </button>
            )}
        </>
    )
}