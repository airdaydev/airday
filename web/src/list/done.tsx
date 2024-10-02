/**
 * Done is a record of historical items
 * In its simplest form, shows you when you finished an item
 * Jump to month? Load all? (Mock!)
 * Get a timeline view indexed so you can see what was going on
 * Can select many, can drag to other lists but can't drag in own list
 */

import { For, useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { DoneListHeader } from "./list-header";
import { DataView } from "../view/state";

export const Done = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  const items = session.workspace.historical.items[0]();
  return (
    <div>
      <DoneListHeader view={props.view} />
      <For each={items}>{(item, index) => <div>{item.content}</div>}</For>
    </div>
  );
};
