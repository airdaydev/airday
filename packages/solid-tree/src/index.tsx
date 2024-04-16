/* @refresh reload */
import { render } from 'solid-js/web';
import { Tree } from './tree';
import { dummyTree } from './dummy';
import { RootNode } from './state';

const root = document.getElementById('root');

const rootA = new RootNode();
rootA.load(dummyTree());

const rootB = new RootNode();
rootB.load(dummyTree());

render(() => (
  <div style={`top: 0; left: 0; position: absolute; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;`}>
    <div>
      <h2>List A ({rootA.count()} items)</h2>
      <Tree
        items={rootA}
      />
    </div>
    <div>
      <h2>List B ({rootB.count()} items)</h2>
      <Tree
        items={rootB}
      />
    </div>
  </div>
), root!);
