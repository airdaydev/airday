interface BordeItem {
  id: string;
  text: string;
  tsCreated: Date;
  tsCompleted: Date | null;
  sortKey: string; // global, persisted sort key
  sticker?: string;
  listId: string;
}

interface BordeContainer {
  id: string;
  name: string;
  sortKey: string;
  icon?: string;
  // TODO: sortKey
}

type SelectItemMode = 'normal' | 'add' | 'addOne' | 'remove';

interface SelectItemsOpts {
  mode: SelectItemMode;
  setOrigin?: boolean,
}

type ListDirection = 'next' | 'prev';

type OrderedKey = [string, string, string];

type FastListType = 'trash' | 'upNext' | 'container' | 'done';

interface BordeViewBase {
  id: string;
  type: FastListType;
}

// TODO: Finish these, useful for type checking
interface BordeContainerView extends BordeViewBase {
  containerId: string;
  type: 'container';
  projection: 'list' | 'kanban';
}

interface BordeDoneView extends BordeViewBase {
  type: 'done';
}

type BordeView = BordeContainerView | BordeDoneView;
