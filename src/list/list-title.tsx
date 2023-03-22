import { createSignal, Signal } from 'solid-js';
import { keyboardShortcuts } from '../keyboard';
import { containerModel } from "../store/main";
import { moveCaretToPosition } from './utils';

interface EditableListTitleProps {
    container: Signal<AcmeContainer>;
}

export const EditableListTitle = (props: EditableListTitleProps) => {
    let inputRef: HTMLInputElement | undefined;
    function handleEditClick(event: MouseEvent) {
        if (inputRef !== event.target) leaveEditMode();
    }
    function handleEditKeyPress(event: KeyboardEvent) {
        if (event.key === 'Enter' || event.key === 'Escape') {
            leaveEditMode();
        }
    }
    function leaveEditMode() {
        keyboardShortcuts.enable();
        // Blur doesn't kill selection range within input so we do it manually
        moveCaretToPosition(inputRef as HTMLInputElement, 0);
        inputRef?.blur();
        window.removeEventListener('mousedown', handleEditClick);
        window.removeEventListener('keydown', handleEditKeyPress);
    }
    function enterEditMode() {
        keyboardShortcuts.disable()
        window.addEventListener('mousedown', handleEditClick);
        window.addEventListener('keydown', handleEditKeyPress)
    }
    // prevent keyboard shortcuts when in edit mode
    // no renaming Inbox (i.e. special container attr - or literally by name)
    // explicit blur behaviour (window.addEventListener, is element target or does it contain it?)
    return (
        <input
            ref={inputRef}
            onFocus={() => enterEditMode()}
            type="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck={false}
            value={props.container[0]().name}
            onChange={(event) => props.container[1]((prev) => {
                return {
                    ...prev,
                    name: event.target.value || 'Untitled',
                }
            })}
            style={`
                font-family: inherit;
                font-size: 1.25rem;
                border: none;
                outline: none;
                background: none;
            `}
        />
    )
    // <h2 style={`margin: 0.5em 0;`}></h2>
}