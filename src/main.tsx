/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './app';
import './main.css';
import { store } from './store/main';
import { genTestData, acmeItems, inboxItems } from './store/dummy-data';

await store.init();

const items = [
  ...genTestData('acmelist', acmeItems),
  ...genTestData('inbox', inboxItems),
]
await store.insert(items);
await store.insertLists([
  { id: 'inbox', name: 'Inbox' },
  { id: 'acmelist', name: 'AcmeList' },
])

const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error('App root missing.');
}

render(() => <App />, root);
