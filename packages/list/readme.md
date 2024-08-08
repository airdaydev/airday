# @solid-borde/list

A very opinionated interactive list system including store & UI component for SolidJS written for borde.app. Drag & drop, optionally virtualised or variable height (can be determined by function).

The architecture has lead to a few marked special cases, dealing with many subtle difference between dragging locally & dragging to a foreign list, as well as differences in the placeholders beneath the originally dragged item & other items and special cases for the final placeholder in remote and local drags.

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
- Which list is in focus? / keyboard controller
- Escape to deselect
- Automatically deselect on blur
- option + arrow to move up / down
- gg/G = top/bottom of list
- double click to open item for editing / quick editing?
- command + down/up to jump to top/bottom of list
- Mobile controls

## Stretch goals
- Variable heights
- Dynamically retrieved, variable heights
- Tree
- Prevent infinite recursion in tree

## Bugs
- On refresh, in Firefox (at least), when scroll bar assumes (same?) position, dragging an item drasticall moves the list (definitely happens in case that list size changes)
- When dragging directly down to the end of list with overflow-y, the list jumps up and back down again! I suspect it is a value not resetting in the autoscroll controller after leaving and rejoining.
- Rare: take a short list & select most but not the last item, drag from the bottom near the last item, and the final placeholder will activate below the last item placeholder (I believe)

# Other options:
- [Draggable](https://shopify.github.io/draggable/examples/sort-animation.html)
- [Sortable](https://sortablejs.github.io/Sortable/#multi-drag)
- [Muuri](https://muuri.dev/)
- [Pragmatic Drag & Drop](https://atlassian.design/components/pragmatic-drag-and-drop/about) - No animation support
- [Dragula](https://bevacqua.github.io/dragula/) - No animation support afaik, not well maintained
- [DNDKit](https://master--5fc05e08a4a65d0021ae0bf2.chromatic.com/?path=/story/presets-sortable-multiple-containers--basic-setup) - for React only
