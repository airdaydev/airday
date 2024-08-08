import { ListDragContext } from './dnd-context';

export class ListShortcuts {
  enabled = false;
  dndContext: ListDragContext;
  constructor(dndContext: ListDragContext) {
    this.dndContext = dndContext;
  }
  listen(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' || event.key === 'K') {
      // Up movement from selection or bottom
      if (event.metaKey) {
        // jump to & select top of list
      }
      if (event.shiftKey) {
        // Add to selection up
      }
      if (event.altKey) {
        // Move item up
      }
    }
    if (event.key === 'ArrowDown' || event.key === 'J') {
      // Up movement from selection or top
      if (event.metaKey) {
        // jump to & select bottom of list
      }
      if (event.shiftKey) {
        // Add to selection down
      }
      if (event.altKey) {
        // Move item down
      }
    }
    if (event.key === 'Escape') {
      // Clear selection
    }
    if (event.key === 'gg') {
      // jump to & select top of list
    }
    if (event.key === 'G') {
      // jump to & select bottom of list
    }
  }
}
