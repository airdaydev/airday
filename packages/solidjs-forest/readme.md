# solidjs-forest

An opinionated tree system including store & UI component for SolidJS written for borde.app. Drag & drop, multi-levels, optionally virtualised or variable height (can be determined by function).

## Features
- Window expands to fill minimum size.
- Virtualised window.
- Drag & Drop with custom components.
- Items can have variable height in non-virtual mode.
- Searching & filters.
- Animated transitions & dragging.

TODO: include webm vid

## An typical example
```typescript
import { TreeState, Tree, Node, type GenericNode } from '@solidjs-forest';

class Group extends Node {
  type = 'group';
  allowChildren = true;
  name?: text;
}

class Country extends Node {
  type = 'country';
  allowChildren = false;
  name?: text;
}

function loader(node: GenericNode) {
  if (rawNode.type === 'group') {
    return new Group({ name: node.name });
  }
  if (rawNode.type === 'country') {
    return new Country({ name: node.name });
  } 
  return false;
}

const treeState = new TreeState<ListItemType>({
  loader,
});

treeState.loadChildren([
  { id: '1', type: 'group', name: 'Asia' },
  {
    id: '2',
    type: 'group',
    name: 'Oceania',
    children: [
      { id: '3', type: 'country', name: 'Australia' },
      { id: '4', type: 'country', name: 'NZ' },
    ]
  },
  { id: '5', type: 'group', name: 'North America' },
]);
```

## Development
```bash
pnpm install
pnpm run dev
```

## Roadmap
- Prevent infinite recursion
- Variable heights
- Dynamically retrieved, variable heights
