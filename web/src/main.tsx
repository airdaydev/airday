/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './app';
import './main.css';
import { createContext } from 'solid-js';

// TODO: Render while store is alive (i.e. Allow models to run without db layer)

const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error('App root missing.');
}

render(() => <App />, root);
