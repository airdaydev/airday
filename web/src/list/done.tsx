/**
 * Done is a record of historical items
 * In its simplest form, shows you when you finished an item
 * Jump to month? Load all? (Mock!)
 * Get a timeline view indexed so you can see what was going on
 * Can select many, can drag to other lists but can't drag in own list
 */

import { useContext } from "solid-js";
import { sessionContext } from "../store/context";

export const Done = () => {
  const session = useContext(sessionContext);
  const items = session.workspace.itemStore
    .getCompletedItems()
    .then((d) => console.log(d));
  return <div>Historical items here</div>;
};
