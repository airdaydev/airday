import { createEffect, on, createSignal } from 'solid-js';
import { moveCaretToPosition } from '../list/utils';
import { keyboardShortcuts } from '../keyboard';

interface NavItemProps {
    
}

/**
 * Navigate to, edit title of & open context menu of a container
 */
export const NavItem = (props: NavItemProps) => {
    let containerRef: HTMLDivElement | undefined;
    let dummyRef: HTMLDivElement | undefined;
    let textAreaRef: HTMLInputElement | undefined;
    const [edit, setEdit] = createSignal();
    const [caretPos, setCaretPos] = createSignal(0);
    function enterEditMode() {
        keyboardShortcuts.disable();
        // props.selection.clear();
        setEdit(true);
    }
    function leaveEditMode(save?: boolean) {
        if (save) {
            // optimistically update fastList, then idb
            // TODO: Update here
        }
        keyboardShortcuts.enable();
        setEdit(false);
    }
    function editModeKeyboardHandler(event: KeyboardEventInit) {
        if (event.key === 'Enter' && !event.shiftKey) {
            leaveEditMode(true);
            return;
        }
        if (event.key === 'Escape') {
            leaveEditMode(true);
            return;
        }
    }
    createEffect(on([edit], () => {
        if (textAreaRef && dummyRef) {
            textAreaRef.focus();
            moveCaretToPosition(textAreaRef, caretPos());
            dummyRef.textContent = textAreaRef.value;
        }
    }))
    return (
        <>
        {/* TODO: Find better control flow component from SolidJS docs */}
        {edit() ? (
            <h2>
                edit title
            </h2>
        ) : (
            <h2>
                display
            </h2>
        )}
        </>
    );
}