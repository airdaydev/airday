import { FastList } from './fast-list';

// Fast list variant for showing completed items
// Characteristics:
// - Fully Draggable, but only droppable in only one position, top of the list.
// - Completing an item moves it to its original list, or inbox if not found


export class DoneFastList extends FastList {
    constructor(props) {
        super(props);
    }
}