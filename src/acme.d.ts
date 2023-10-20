interface AcmeItem {
  id: string;
  text: string;
  tsCreated: string;
  tsCompleted: Date | null;
  sortKey: string; // global, persisted sort key
  listId: string;
}

interface AcmeContainer {
  id: string;
  name: string;
  sortKey: string;
  // TODO: sortKey
  // TODO: icon
}

type SelectItemMode = 'normal' | 'add' | 'addOne' | 'remove';

interface SelectItemsOpts {
  mode: SelectItemMode;
  setOrigin?: boolean,
}

type ListDirection = 'next' | 'prev';

type OrderedKey = [string, string, string];

interface AcmeViewBase {
  id: string;
  type: 'upNext' | 'container' | 'done';
}

interface AcmeContainerView extends AcmeViewBase {
  containerId: string;
  type: 'container';
  projection: 'list' | 'kanban';
}

interface AcmeDoneView extends AcmeViewBase {
  type: 'done';
}

type AcmeView = AcmeContainerView | AcmeDoneView;