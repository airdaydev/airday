/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './app';
import './main.css';
import { SessionStore } from './store/main';
import { sessionContext } from './store/context';

// Setup app state
const sessionStore = new SessionStore();
sessionStore.loadWorkspaceCache();

// TODO: Render while store is alive (i.e. Allow models to run without db layer)
const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error('App root missing.');
}

render(() => (
  <sessionContext.Provider value={sessionStore}>
    {sessionStore.workspace && (
      <App />
    )}
  </sessionContext.Provider>
), root);
