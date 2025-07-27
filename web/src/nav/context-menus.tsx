import { Accessor, useContext } from "solid-js";
import { sessionContext } from "../store/context.js";
import { ContextMenu } from "../context-menu/context-menu";
import { Key } from "../generic/key.jsx";

interface AirContextMenuProps {
  close: () => void;
  buttonRef?: HTMLElement;
  offset: [number, number];
  containerZIndex: number;
}

export function AirContextMenu(props: AirContextMenuProps) {
  const session = useContext(sessionContext);
  return (
    <ContextMenu
      close={props.close}
      offset={props.offset}
      anchor="bottom"
      containerZIndex={10}
      buttonRef={props.buttonRef}
    >
      <button
        onClick={() => {
          session.viewState.sidebarVisible[1]((prev) => !prev);
          props.close();
        }}
        style="display: flex;
          justify-content: space-between;
          align-items: center;
          width: 12em;"
      >
        <span>
          {session.viewState.sidebarVisible[0]() ? "Hide" : "Show"} Sidebar
        </span>
        <div>
          <Key key="⌥" />
          <Key key="S" />
        </div>
      </button>
      <button disabled>
        <span>Settings</span>
      </button>
      <hr />
      <button disabled>
        <span>Download apps</span>
      </button>
      <button disabled>
        <span>About Airday</span>
      </button>
    </ContextMenu>
  );
}

interface LibraryContextMenuProps {
  close: () => void;
  offset: [number, number];
  buttonRef?: HTMLElement;
}

export function LibraryContextMenu(props: LibraryContextMenuProps) {
  const session = useContext(sessionContext);
  return (
    <ContextMenu
      close={props.close}
      offset={props.offset}
      anchor="bottom"
      containerZIndex={10}
      buttonRef={props.buttonRef}
    >
      <div>
        {Array.from(session.map.values()).map((library) => (
          <div style={"padding: 0.25em 0.5em;"}>
            <div>{library.name}</div>
            <div style={"color: var(--body-tint);"}>{library.id}</div>
          </div>
        ))}
      </div>
      <hr />
      <button
        onClick={async () => {
          await session.library.reset();
          session.library.dummyData();
        }}
      >
        Reset db
      </button>
    </ContextMenu>
  );
}

interface AccountContextMenuProps {
  close: () => void;
  offset: [number, number];
}

export function AccountContextMenu(props: AccountContextMenuProps) {
  return (
    <ContextMenu close={props.close} offset={props.offset}>
      <button disabled>
        <span>Account</span>
      </button>
      <hr />
      <button disabled>
        <span>Sign out</span>
      </button>
    </ContextMenu>
  );
}

interface NavItemContextMenuProps {
  close: () => void;
  container: Accessor<AirContainer>;
  offset: [number, number];
}

export function NavItemContextMenu(props: NavItemContextMenuProps) {
  const session = useContext(sessionContext);
  return (
    <ContextMenu
      close={props.close}
      container={props.container}
      offset={props.offset}
    >
      <button disabled>
        <span>Rename</span>
      </button>
      <button disabled>
        <span>Export</span>
      </button>
      <button
        onClick={() => {
          session.library.containerStore.remove(props.container().id);
        }}
      >
        <span>Delete</span>
      </button>
    </ContextMenu>
  );
}
