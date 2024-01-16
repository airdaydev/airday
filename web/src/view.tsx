import { Done } from './list/done';
import { List } from './list/list';

interface ViewProps {
  view: BordeView,
  tabId: number,
}

/**
 * Unwraps view object and ensures corresponding view created
 */
export function View(props: ViewProps) {
  // Type checking
  return (
    <List view={props.view} tabId={props.tabId} />
  );
}
