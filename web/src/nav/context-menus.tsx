import { Accessor } from 'solid-js';
import { ContextMenu } from '../context-menu/context-menu';
import { viewState } from '../view-state';

interface BordeContextMenuProps {
  close: () => void;
  style: string;
}

export function BordeContextMenu(props: BordeContextMenuProps) {
  return (
    <ContextMenu
      style={props.style}
      close={props.close}
    >
      <button
        onClick={() => {
          viewState.sidebarVisible[1]((prev) => !prev)
          props.close();
        }}
      >
        <span>{viewState.sidebarVisible[0]() ? 'Hide' : 'Show'} Sidebar</span>
      </button>
      <button disabled>
        <span>Settings</span>
      </button>
      <hr />
      <button disabled>
        <span>About Borde</span>
      </button>
    </ContextMenu>
  )
}

interface WorkspaceContextMenuProps {
  close: () => void;
  style: string;
}

export function WorkspaceContextMenu(props: WorkspaceContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      style={props.style}
    >
      <button disabled>
        <span>Workspace 1</span>
      </button>
      <button disabled>
        <span>Create new workspace</span>
      </button>
      <hr />
      <button disabled>
        <span>Import</span>
      </button>
      <button disabled>
        <span>Export</span>
      </button>
    </ContextMenu>
  )
}

interface AccountContextMenuProps {
  close: () => void;
  style: string;
}

export function AccountContextMenu(props: AccountContextMenuProps) {
  return (
    <ContextMenu
      close={props.close}
      style={props.style}
    >
      <button disabled>
        <span>Account</span>
      </button>
      <hr />
      <button disabled>
        <span>Sign out</span>
      </button>
    </ContextMenu>
  )
}

