import { LiveList } from '../store/open-list';
import { AcmeReactiveSelection } from './selection';
import { jumpToElIfOutsideView } from './utils.js';

interface ListKeyboardHandlerParams {
    liveList: LiveList,
    selection: AcmeReactiveSelection,
    scrollRef: HTMLElement,
    containerRef: HTMLElement,
}

export const getListKeyboardHandler = ({
    liveList,
    selection,
    scrollRef,
    containerRef,
}: ListKeyboardHandlerParams) => (event: KeyboardEvent) => {
    const list = liveList.signal();
    if (event.key === 'Escape') {
      event.preventDefault();
      selection.clear();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (event.altKey && event.shiftKey && selection.keys.size) {
        // TODO: Implement behaviour (select all the way down)
      }
      if (event.altKey) {
        if (!list.length) return;
        selection.selectOne(list[list.length - 1].id);
        jumpToElIfOutsideView(scrollRef, containerRef.childNodes[list.length - 1])
        return;
      }
      // - on key down, select next down from last selected, set last selected, origin
      if (!selection.lastKeySelected) {
        const neighbour = list[0];
        if (neighbour) selection.selectOne(neighbour.id);
        return;
      }
      if (selection.lastKeySelected && !event.shiftKey) {
        const neighbour = liveList.getNeighbourIndex(selection.lastKeySelected);
        if (neighbour) {
          selection.selectOne(list[neighbour].id);
          jumpToElIfOutsideView(scrollRef, containerRef.childNodes[neighbour])
        }
      }
      if (selection.rangeOrigin && event.shiftKey) {
        // contiguous area below origin, continue:
        const origin = liveList.getIndexOfKey(selection.rangeOrigin);
        if (origin === false) return;
        // Check if items above
        const prevIndex = liveList.getNextNotInSet(origin, selection.keys, 'prev');
        if (prevIndex === origin - 1  || origin === 0) {
          // select down
          const index = liveList.getNextNotInSet(origin, selection.keys);
          if (index !== false) {
            selection.addKey(list[index].id);
            jumpToElIfOutsideView(scrollRef, containerRef.childNodes[index])
          }
        } else {
          // deselect down
          selection.removeKey(prevIndex !== false ? list[prevIndex + 1].id : list[0].id);
        }
        return;
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.altKey && event.shiftKey && selection.keys.size) {
        // TODO: Implement behaviour (select all the way up)
      }
      if (event.altKey) {
        if (!list.length) return;
        selection.selectOne(list[0].id);
        jumpToElIfOutsideView(scrollRef, containerRef.childNodes[0]);
        return;
      }
      // - on key up, select next down from last selected, set last selected, origin
      if (!selection.lastKeySelected) {
        const neighbour = list[list.length - 1];
        if (neighbour) selection.selectOne(neighbour.id);
        return;
      }
      if (selection.lastKeySelected && !event.shiftKey) {
        const neighbour = liveList.getNeighbourIndex(selection.lastKeySelected, 'prev');
        if (neighbour !== false) {
          selection.selectOne(liveList.signal()[neighbour].id);
          jumpToElIfOutsideView(scrollRef, containerRef.childNodes[neighbour]);
        }
      }
      if (selection.rangeOrigin && event.shiftKey) {
        // contiguous area below origin, continue:
        const origin = liveList.getIndexOfKey(selection.rangeOrigin);
        if (origin === false) return;
        // Check if items below
        const nextIndex = liveList.getNextNotInSet(origin, selection.keys, 'next');
        if (nextIndex === origin + 1 || origin === list.length - 1) {
          // select up
          const index = liveList.getNextNotInSet(origin, selection.keys, 'prev');
          if (index !== false) {
            selection.addKey(list[index].id);
            jumpToElIfOutsideView(scrollRef, containerRef.childNodes[index]);
          }
        } else {
          // deselect up
          selection.removeKey(nextIndex !== false ? list[nextIndex - 1].id : list[list.length - 1].id);
          return;
        }
      }
    }
  }