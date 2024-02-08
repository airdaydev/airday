import { nanoid } from 'nanoid';
import { FastList } from '../store/fast-list';
import { AcmeReactiveSelection } from './selection';
import { jumpToElIfOutsideView } from './utils.js';

interface ListKeyboardHandlerParams {
    fastList: FastList,
    selection: AcmeReactiveSelection,
    scrollRef: HTMLElement,
}

export const getListKeyboardHandler = ({
    fastList,
    selection,
    scrollRef,
}: ListKeyboardHandlerParams) => (event: KeyboardEvent) => {
    const list = fastList.signal[0]();
    if (event.key === 'n') {
      event.preventDefault();
      // TODO: Find position:
      // find active list (or first list)
      // find item below currently selected item (and jump to it)
      const firstSelected = fastList.getFirstIndexOfSet(selection.keys);
      const position = firstSelected ? firstSelected : 0;
      fastList.add([{
          id: nanoid(),
          listId: fastList.listId,
          text: '',
          tsCreated: new Date(),
          open: true,
      }], position);
      // TODO: Create item
    }
    if (event.key === 'a' && event.metaKey) {
        event.preventDefault();
        const allKeys = list.map((item) => item);
        selection.addKeys(allKeys);
        return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      selection.clear();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (event.altKey && event.shiftKey && selection.keys.size) {
        const firstSelectedIndex = fastList.getFirstIndexOfSet(selection.keys) as number;
        const keys = fastList.getKeysInRange(firstSelectedIndex, list.length - 1);
        selection.clear();
        selection.addKeys(keys);
        return;
      }
      if (event.altKey) {
        if (!list.length) return;
        selection.selectOne(list[list.length - 1]);
        jumpToElIfOutsideView(scrollRef, scrollRef.childNodes[list.length - 1])
        return;
      }
      // - on key down, select next down from last selected, set last selected, origin
      if (!selection.lastKeySelected) {
        const neighbour = list[0];
        if (neighbour) selection.selectOne(neighbour);
        return;
      }
      if (selection.lastKeySelected && !event.shiftKey) {
        event.preventDefault();
        const neighbour = fastList.getNeighbourIndex(selection.lastKeySelected);
        if (neighbour) {
          selection.selectOne(list[neighbour]);
          jumpToElIfOutsideView(scrollRef, scrollRef.childNodes[neighbour])
        }
      }
      if (selection.rangeOrigin && event.shiftKey) {
        event.preventDefault();
        // contiguous area below origin, continue:
        const origin = fastList.getIndexOfKey(selection.rangeOrigin);
        if (origin === false) return;
        // Check if items above
        const prevIndex = fastList.getNextNotInSet(origin, selection.keys, 'prev');
        if (prevIndex === origin - 1  || origin === 0) {
          // select down
          const index = fastList.getNextNotInSet(origin, selection.keys);
          if (index !== false) {
            selection.addKey(list[index]);
            jumpToElIfOutsideView(scrollRef, scrollRef.childNodes[index])
          }
        } else {
          // deselect down
          selection.removeKey(prevIndex !== false ? list[prevIndex + 1] : list[0]);
        }
        return;
      }
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.altKey && event.shiftKey && selection.keys.size) {
        const lastSelectedIndex = fastList.getLastIndexOfSet(selection.keys) as number;
        const keys = fastList.getKeysInRange(0, lastSelectedIndex);
        selection.clear();
        selection.addKeys(keys);
        return;
      }
      if (event.altKey) {
        if (!list.length) return;
        selection.selectOne(list[0]);
        jumpToElIfOutsideView(scrollRef, scrollRef.childNodes[0]);
        return;
      }
      // - on key up, select next down from last selected, set last selected, origin
      if (!selection.lastKeySelected) {
        const neighbour = list[list.length - 1];
        if (neighbour) selection.selectOne(neighbour);
        return;
      }
      if (selection.lastKeySelected && !event.shiftKey) {
        const neighbour = fastList.getNeighbourIndex(selection.lastKeySelected, 'prev');
        if (neighbour !== false) {
          selection.selectOne(fastList.signal[0]()[neighbour]);
          jumpToElIfOutsideView(scrollRef, scrollRef.childNodes[neighbour]);
        }
      }
      if (selection.rangeOrigin && event.shiftKey) {
        // contiguous area below origin, continue:
        const origin = fastList.getIndexOfKey(selection.rangeOrigin);
        if (origin === false) return;
        // Check if items below
        const nextIndex = fastList.getNextNotInSet(origin, selection.keys, 'next');
        if (nextIndex === origin + 1 || origin === list.length - 1) {
          // select up
          const index = fastList.getNextNotInSet(origin, selection.keys, 'prev');
          if (index !== false) {
            selection.addKey(list[index]);
            jumpToElIfOutsideView(scrollRef, scrollRef.childNodes[index]);
          }
        } else {
          // deselect up
          selection.removeKey(nextIndex !== false ? list[nextIndex - 1] : list[list.length - 1]);
          return;
        }
      }
    }
  }
