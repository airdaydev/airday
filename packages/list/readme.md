# @sunlist/tree

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
- [x] Dragging from foreign list into autoscroller keeps autoscroller going
- [x] Dragging to top item on foreign list and back keeps the placeholder in place (flashes)
- [x] Reintegrate non-native dnd, as option
- [] Clean switching on the fly between drag modes (native vs custom)
- [] Custom ghost for native drop
- [] Handle external drag and drop
- [] Variable item heights...
- [] moving item down follows user
- [] jumping to top and bottom smooth scroll (try?)
- [] Provide API for rejecting bad drops ahead of time so UI can respond
- [] Touch version
- [] In rows below items of a greater nesting, users can move horizontally to drag through different depths
- [] Add Empty item state for groups with nothing in them (optionally via node property)
- [] Ensure list tracked dimensions match list size at all times
- [] Make native dnd optional, because it kind of fuckin sucks (no work on android bruh, lots of bs going on other platforms)

## Roadmap
- Pure canvas version
- GPU version
- Move down via line numbers (vim)

# Other options:
- [Draggable](https://shopify.github.io/draggable/examples/sort-animation.html)
- [Sortable](https://sortablejs.github.io/Sortable/#multi-drag)
- [Muuri](https://muuri.dev/)
- [Pragmatic Drag & Drop](https://atlassian.design/components/pragmatic-drag-and-drop/about) - No animation support
- [Dragula](https://bevacqua.github.io/dragula/) - No animation support afaik, not well maintained
- [DNDKit](https://master--5fc05e08a4a65d0021ae0bf2.chromatic.com/?path=/story/presets-sortable-multiple-containers--basic-setup) - for React only
