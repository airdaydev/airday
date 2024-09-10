// import { Done } from "./list/done";
import { List } from "../list/list";
import { viewContext, viewState } from "./state";

interface ViewProps {
  view: BordeView;
  tabId: number;
}

/**
 * Unwraps view object and ensures corresponding view created
 */
export function View(props: ViewProps) {
  // Type checking
  return (
    <viewContext.Provider value={viewState}>
      <List view={props.view} tabId={props.tabId} />
    </viewContext.Provider>
  );
}
