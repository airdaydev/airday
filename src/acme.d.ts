interface AcmeItem {
  id: string;
  text: string;
  dateCreated: string;
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

interface AcmeView {
  id: string;
  containerId: string;
  projection: 'list' | 'kanban';
}