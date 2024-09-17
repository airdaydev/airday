import { useContext } from "solid-js";
import { sessionContext } from "../store/context.js";
import { ContextMenu } from "../context-menu/context-menu";
import { viewState } from "../view/state";

interface BordeContextMenuProps {
  close: () => void;
  offset: [number, number];
}

export function BordeContextMenu(props: BordeContextMenuProps) {
  return (
    <ContextMenu close={props.close} offset={props.offset} anchor="bottom">
      <button
        onClick={() => {
          viewState.sidebarVisible[1]((prev) => !prev);
          props.close();
        }}
      >
        <span>{viewState.sidebarVisible[0]() ? "Hide" : "Show"} Sidebar</span>
      </button>
      <button disabled>
        <span>Settings</span>
      </button>
      <hr />
      <button disabled>
        <span>Download apps</span>
      </button>
      <button disabled>
        <span>About SunList</span>
      </button>
    </ContextMenu>
  );
}

interface WorkspaceContextMenuProps {
  close: () => void;
  offset: [number, number];
}

export function WorkspaceContextMenu(props: WorkspaceContextMenuProps) {
  const session = useContext(sessionContext);
  return (
    <ContextMenu close={props.close} offset={props.offset} anchor="bottom">
      <div>
        {Array.from(session.map.values()).map((workspace) => (
          <button disabled>
            <div>{workspace.name}</div>
            <div>{workspace.id}</div>
          </button>
        ))}
      </div>
      <hr />
      <button disabled>
        <span>Workspace settings</span>
      </button>
      <button disabled>
        <span>Export Workspace</span>
      </button>
      <button
        onClick={async () => {
          await session.workspace.reset();
          session.workspace.dummyData();
        }}
      >
        DEV DB RESET
      </button>
      <hr />
      <button disabled>
        <span>Create new workspace</span>
      </button>
      <button disabled>
        <span>Import Workspace</span>
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
  container: Accessor<BordeContainer>;
  offset: [number, number];
}

export function NavItemContextMenu(props: NavItemContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      container={props.container}
      offset={props.offset}
    >
      <button
        onClick={() => {
          viewState.addContainerView(props.container().id);
          props.close();
        }}
      >
        <span>Open in new view</span>
      </button>
      <button disabled>
        <span>Export</span>
      </button>
      <button disabled>
        <span>Delete</span>
      </button>
    </ContextMenu>
  );
}
