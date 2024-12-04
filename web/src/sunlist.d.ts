interface SunlistItem {
  id: string;
  text: string;
  tsCreated: Date;
  tsDone: Date | null;
  sortKey: string; // global, persisted sort key
  sticker?: string;
  listId: string;
}

interface SunlistContainer {
  id: string;
  name: string;
  sortKey: string;
  icon?: string;
  // TODO: sortKey
}

type SelectItemMode = "normal" | "add" | "addOne" | "remove";

interface SelectItemsOpts {
  mode: SelectItemMode;
  setOrigin?: boolean;
}

type ListDirection = "next" | "prev";

type OrderedKey = [string, string, string];

type FastListType = "trash" | "upNext" | "container" | "done";

interface SunlistViewBase {
  id: string;
  type: FastListType;
}

// TODO: Finish these, useful for type checking
interface SunlistContainerView extends SunlistViewBase {
  containerId: string;
  type: "container";
  projection: "list" | "kanban";
}

interface SunlistDoneView extends SunlistViewBase {
  type: "done";
}

type SunlistView = SunlistContainerView | SunlistDoneView;
