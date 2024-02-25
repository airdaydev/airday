import { store } from './main';

interface Workspace {
  id: string;
  localOnly: boolean;
  name: string;
}

// This is a local storage based API that deals with sessions
// and controls which workspace is active
// It is serialised in localstorage
class SessionStore {
  // TODO: An actual auth mechanism
  user: string = 'anonymous';
  workspaces = new Map<string, Workspace>();
  // TODO: This potentially belongs elsewhere
  activeWorkspace?: string;
  activePanes: string[] = [];
  constructor() {
    this.init();
  }
  init() {
    const activeWorkspace = localStorage.getItem('activeWorkspace');
    store.reset();
    store.connect('activeWorkspace');
    // Attempt to create new idb connection to active workspace
    // If it doesn't exist, attempt to authenticate
    // If offline
  }
  authenticate() {
    // authenticate
    // load workspace
    // get & save workspaces
  }
  changeWorkspace(id: string) {
    const workspace = this.workspaces.get(id);
  }
  reset() {
    this.workspaces.clear();
    this.workspaces.set('anonymous', {
      id: 'anonymous', // TODO: Generate id
      name: 'test',
      localOnly: true,
    });
    this.changeWorkspace('anonymous');
  }
}

// Instantiate as singleton
export const sessionStore = new SessionStore();
