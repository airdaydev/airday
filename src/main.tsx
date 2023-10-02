/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './app';
import './main.css';
import { store } from './store/main';
import { genTestData, acmeItems, inboxItems } from './store/dummy-data';

// TODO: Render while store is alive (i.e. Allow models to run without db layer)

const items = [
  ...genTestData('acmelist', acmeItems),
  ...genTestData('inbox', inboxItems),
]
await store.itemModel.insert(items);
await store.containerModel.insert([
  {
    id: 'inbox',
    name: 'Inbox',
  },
  {
    id: 'acmelist',
    name: 'AcmeList',
  },
  {
    id: 'empty-list',
    name: 'a really really long named list',
  },
]);

const root = document.getElementById('root');

if (!(root instanceof HTMLElement)) {
  throw new Error('App root missing.');
}

render(() => <App />, root);
