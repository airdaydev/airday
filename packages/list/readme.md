# @sunlist/list

An interactive tree system including store & UI component for SolidJS written for sunlist.app. Drag & drop, virtualised, static height per element.

## Features
- Drag and drop placeholders via underlaid canvas, same size as item.
- Virtualised window (ensure scroll list is correctly sized).
- List expands to fill size of container.
- A shared DndContext allows multiple lists to interact with each other.
- Searching & filters.
- Animated transitions & dragging.
- Granular updates on individual items applied without looping over list.

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

## V3 roadmap
- [x] Dragging to other lists
- [x] Smooth autoscrolling
- [x] Can't drop below last item
- [x] Integrate native drag and drop
- [] Bug when after offset 0 in scroll container, weird stuff happens when you drag (probably try solution below re not having dragged item in list but extracting it manually and putting it in a cheeky portal)
- [] Handle external drag and drop
- [] Variable item heights...
- [] Virtual list height correctly calculated (BUG!)
- [] Provide API for rejecting bad positions ahead of time so UI can respond
- [] Touch version
- [] Nested movement fixes
- [] Ensure list tracked dimensions match list size at all times
- [] In rows below items of a greater nesting, users can move horizontally to drag through different depths

## Roadmap
- GPU version?
- move down via line numbers (vim)

## Ugly bits
- I'm keeping the dragged item (not items) IN the list which means I have to do a few weird calculations to account for it, potentially, I could instead, place that node in a portal underneath the mouse
- When moving a lot of items (10 000s), O(2N) to sort each move!!

# Other options:
- [Draggable](https://shopify.github.io/draggable/examples/sort-animation.html)
- [Sortable](https://sortablejs.github.io/Sortable/#multi-drag)
- [Muuri](https://muuri.dev/)
- [Pragmatic Drag & Drop](https://atlassian.design/components/pragmatic-drag-and-drop/about) - No animation support
- [Dragula](https://bevacqua.github.io/dragula/) - No animation support afaik, not well maintained
- [DNDKit](https://master--5fc05e08a4a65d0021ae0bf2.chromatic.com/?path=/story/presets-sortable-multiple-containers--basic-setup) - for React only
