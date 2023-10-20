import { Done } from './list/done';
import { List } from './list/list';

interface ViewProps {
  view: AcmeView,
  tabId: number,
}

/**
 * Unwraps view object and ensures corresponding view created
 */
export function View(props: ViewProps) {
  // Type checking
  if (props.view.type === 'container') {
    return (
      <List view={props.view} tabId={props.tabId} />
    );
  }
  if (props.view.type === 'done') {
    return (
      <Done tabId={props.tabId} />
    );
  }
}
