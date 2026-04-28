import {
  createSignal,
  createEffect,
  on,
  useContext,
  createUniqueId,
} from "solid-js";
import { sessionContext } from "../store/context.js";
import styles from "./nav.module.css";

/**
 * 2 stage add button
 * 1. Start input
 * 2. Finish input on enter
 */
export const AddListButton = () => {
  const session = useContext(sessionContext);
  let inputRef: HTMLInputElement | undefined = undefined;
  const [editing, setEditing] = createSignal<boolean>(false);
  const leaveEditMode = (save: boolean) => {
    // keyboardShortcuts.enable();
    if (save) {
      const id = createUniqueId();
      session.library.containerStore.insert({
        id,
        name: inputRef?.value || "New list",
        icon: "task",
        sortKey: "f",
        type: "generic-list",
      });
      session.viewState.openDataView(id);
    }
    setEditing(false);
  };
  const enterEditMode = () => {
    // keyboardShortcuts.disable();
    setEditing(true);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Enter") {
      leaveEditMode(true);
    }
    if (event.code === "Escape") {
      leaveEditMode(false);
    }
  };
  createEffect(
    on([editing], () => {
      if (inputRef) {
        inputRef.focus();
      }
    }),
  );
  // TODO: handle outside click
  return (
    <>
      {editing() ? (
        <input
          style="border: none; background: none; cursor: pointer; padding: 0.5em; outline: 0; font-family: inherit; font-size: 1rem;"
          type="text"
          placeholder="New list"
          ref={inputRef}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <button
          class={styles["add-list-button"]}
          onClick={() => enterEditMode()}
          tabIndex={-1}
        >
          Add
        </button>
      )}
    </>
  );
};
