/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './app';
import './main.css';
import { itemModel } from './store/store';
import { genTestData, acmeItems, inboxItems } from './store/dummy-data';

// TODO: Render while store is alive (i.e. Allow models to run without db layer)

const items = [
  ...genTestData('acmelist', acmeItems),
  ...genTestData('inbox', inboxItems),
]
await itemModel.insert(items);
// await itemModel.insertLists([
//   { id: 'inbox', name: 'Inbox' },
//   { id: 'acmelist', name: 'AcmeList' },
// ]);

const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error('App root missing.');
}

render(() => <App />, root);
