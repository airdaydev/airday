/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './app';
import './main.css';
import { sessionContext } from './store/context';
import { SessionStore } from './store/session';

// Setup app state
const sessionStore = new SessionStore();

// TODO: Render while store is alive (i.e. Allow models to run without db layer)
const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error('App root missing.');
}

render(() => (
  <sessionContext.Provider value={sessionStore}>
    <App />
  </sessionContext.Provider>
), root);
