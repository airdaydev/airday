/* @refresh reload */
import { render } from 'solid-js/web';
import { Tree } from './tree';
import { dummyTree } from './dummy';

const root = document.getElementById('root');

const dummyItems = dummyTree();
console.log(dummyItems.children)
// const dummyItems2 = dummyTree();

// render(() => (
//   <div style={`top: 0; left: 0; position: absolute; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;`}>
//     <div>
//       <h2>List A ({dummyItems} items)</h2>
//       <Tree items={dummyItems} />
//     </div>
//     <div>
//       <h2>List B ({dummyItems2} items)</h2>
//       <Tree items={dummyItems2} />
//     </div>
//   </div>
// ), root!)
