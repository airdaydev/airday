# @solid-borde/list

An opinionated tree system including store & UI component for SolidJS written for borde.app. Drag & drop, multi-levels, optionally virtualised or variable height (can be determined by function).

## Features
- Window expands to fill minimum size.
- Virtualised window.
- Drag & drop in same list or to other lists.
- Items can have variable height in non-virtual mode.
- Searching & filters.
- Animated transitions & dragging.
- Granular updates on individual items applied without looping over list.

TODO: include webm vid

## A minimal example

## An typical example
```typescript
import { TreeState, Tree, Node, type GenericNode } from '@solidjs-forest';

class Group extends Node {
  type = 'group';
  allowDrop = true;
  name?: text;
}

class Country extends Node {
  type = 'country';
  allowDrop = false;
  name?: text;
}

// Constructs tree from JSON (for example)
function loader(node: GenericNode) {
  if (rawNode.type === 'group') {
    return new Group({ name: node.name });
  }
  if (rawNode.type === 'country') {
    return new Country({ name: node.name });
  } 
  return false; // Skips item
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
- Bug fix: moving item to foreign list last item no placeholder!
- Bug fix: Taking foreign item into empty bottom space doesn't display placeholder
- Bug fix: Taking foreign item down into last item doesn't display placeholder
- Virtual window works
- Autoscroll down
- Escape to deselect
- Automatically deselect on blur
- shift to select range
- option to add to selection
- option + arrow to move up / down
- command + down/up to jump to top/bottom of list
- Prevent infinite recursion
- Variable heights
- Dynamically retrieved, variable heights

# Others
- [Draggable](https://shopify.github.io/draggable/examples/sort-animation.html)
- [Sortable](https://sortablejs.github.io/Sortable/#multi-drag)
- [Muuri](https://muuri.dev/)
- [Pragmatic Drag & Drop](https://atlassian.design/components/pragmatic-drag-and-drop/about) - No animation support
- [Dragula](https://bevacqua.github.io/dragula/) - No animation support afaik, not well maintained
- [DNDKit](https://master--5fc05e08a4a65d0021ae0bf2.chromatic.com/?path=/story/presets-sortable-multiple-containers--basic-setup) - for React only
