import { nanoid } from 'nanoid';
import { createSignal, Show } from 'solid-js';
import { containerModel } from '../store/main';
import { viewState } from '../view-state';

/**
 * 2 stage add button
 * 1. Start input
 * 2. Finish input on enter
 */
export const AddListButton = () => {
    const [editing, setEditing] = createSignal<boolean>(false);
    const create = () => {
        const id = nanoid();
        containerModel.insert({
            id,
            name: 'New list',
        });
        viewState.replaceActiveView(id);
    }
    const handleKeyDown = () => {

    }
    // if editing, turn off keyboard handler
    return (
        <Show when={editing()}>
            <button
                style='border: none; background: none; cursor: pointer; padding: 0.5em; color: #888;'
                onClick={() => {
                
                }}
              >
                Add list...
              </button>
        </Show>
        {editing() ? (
            
        ) : (

        )}
        </>
    )
}