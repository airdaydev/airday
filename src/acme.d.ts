interface AcmeItem {
  id: string;
  text: string;
  tsCreated: string;
  tsCompleted: Date | null;
  sortKey: string; // global, persisted sort key
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

interface AcmeViewBase {
  id: string;
  type: FastListType;
}

// TODO: Finish these, useful for type checking
interface BordeContainerView extends AcmeViewBase {
  containerId: string;
  type: 'container';
  projection: 'list' | 'kanban';
}

interface AcmeDoneView extends AcmeViewBase {
  type: 'done';
}

type AcmeView = BordeContainerView | AcmeDoneView;