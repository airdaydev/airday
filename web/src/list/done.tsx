/**
 * Done is a record of historical items
 * In its simplest form, shows you when you finished an item
 * Jump to month? Load all? (Mock!)
 * Get a timeline view indexed so you can see what was going on
 * Can select many, can drag to other lists but can't drag in own list
 */

import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { DoneListHeader } from "./list-header";
import { DataView } from "../view/state";
import { TreeContext, SolidListContext, Tree } from "@air-app/list";
import styles from "./list.module.css";
import { ListColumnHeaders } from "./list-col-head";
import { listOptions, ListOptionsContext } from "./list-options";
import { Timeline } from "./timeline";

export const Done = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  const tree = session.workspace.historical.tree;
  const ctx = new TreeContext({
    treeState: tree,
    dndContext: session.workspace.dndContext,
    itemHeight: 32,
    allowInternalMovement: false,
  });
  const opts = listOptions({
    columnHeaders: false,
    columns: ["check", "content", "sticker", "date"],
    historical: true,
  });
  return (
    <ListOptionsContext.Provider value={opts}>
      <section
        classList={{
          [styles.list]: true,
          [styles.focus]: session.viewState.activePane[0]() === props.view,
        }}
        onClick={() => {
          session.viewState.setActivePane(props.view);
        }}
      >
        <DoneListHeader view={props.view} />
        <ListColumnHeaders />
        <SolidListContext.Provider value={ctx}>
          <div
            class={styles["tree-wrap"]}
            // classList={{ [styles["focus"]]: ctx.isFocused() }}
          >
            <Tree
              additionalClasses={{
                [styles["hide-native-scroll"]]: true,
              }}
            />
          </div>
        </SolidListContext.Provider>
        <Timeline />
      </section>
    </ListOptionsContext.Provider>
  );
};
