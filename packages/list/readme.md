# @sunlist/list

An opinionated, imperfect interactive tree system including store & UI component for SolidJS written for sunlist.app.
Drag & drop, virtualised, static height per element.

## Features
- Window expands to fill minimum size.
- Virtualised window.
- Drag & drop in same list or to other lists.
- Items can have variable height in non-virtual mode.
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

## Tree conversion
- [] Last item before depth change activates special placeholder where dragging
over left-most edge places item outside of container (think for multiple levels!)
- [] placeholder indents variable at bottom of children lists depending on mouse location
- [] range select up & down only allowed at same depth
- [] select last item works with nesting
- [] can't drag parent within itself (if same list is open!)

## Roadmap
- Prototype 2D canvas version
- Move to GPU version
- Smoother down scrolling when moving off list item
- move down via line numbers (vim)
- predict doubles to display in vim mode.
- Get autoscroller touch version working with other lists on mobile.
- cmd+d to duplicate

## Stretch goals
- Tree
- Variable heights
- Dynamically retrieved, variable heights
- Prevent infinite recursion in tree

## Bugs
- [] Shifting up/down and deselecting doesn't move viewport when deselecting
- [] Implement keyboard undefined behaviour - deselecting origin and trying to shift!!
- Dragging to another list then using keyboard controls not working
- Implement transitions for deleting & adding items (previously removed this due to issues with animation not finishing)
- Touch drag - when moving back and forth between foreign lists a few times, the simulated touch enter stuff doesn't always work (state bug?)
- On refresh, in Firefox (at least), when scroll bar assumes (same?) position, dragging an item drasticall moves the list (definitely happens in case that list size changes)
- When dragging directly down to the end of list with overflow-y, the list jumps up and back down again! I suspect it is a value not resetting in the autoscroll controller after leaving and rejoining.
- Rare: take a short list & select most but not the last item, drag from the bottom near the last item, and the final placeholder will activate below the last item placeholder (I believe)
- When moving a lot of items (10 000s), O(2N) to sort each move!!

# Other options:
- [Draggable](https://shopify.github.io/draggable/examples/sort-animation.html)
- [Sortable](https://sortablejs.github.io/Sortable/#multi-drag)
- [Muuri](https://muuri.dev/)
- [Pragmatic Drag & Drop](https://atlassian.design/components/pragmatic-drag-and-drop/about) - No animation support
- [Dragula](https://bevacqua.github.io/dragula/) - No animation support afaik, not well maintained
- [DNDKit](https://master--5fc05e08a4a65d0021ae0bf2.chromatic.com/?path=/story/presets-sortable-multiple-containers--basic-setup) - for React only
