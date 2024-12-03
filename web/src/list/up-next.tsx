/**
 * Done is a record of historical items
 * In its simplest form, shows you when you finished an item
 * Jump to month? Load all? (Mock!)
 * Get a timeline view indexed so you can see what was going on
 * Can select many, can drag to other lists but can't drag in own list
 */

import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { UpNextHeader } from "./list-header";
import { DataView } from "../view/state";
import { TreeContext, SolidListContext, Tree } from "@sunlist/list";
import styles from "./list.module.css";
import { ListColumnHeaders } from "./list-col-head";
import { listOptions, ListOptionsContext } from "./list-options";

export const UpNext = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  const tree = session.workspace.upNext.tree;
  const ctx = new TreeContext({
    treeState: tree,
    dndContext: session.workspace.dndContext,
    itemHeight: 32,
  });
  const opts = listOptions({
    columnHeaders: false,
    columns: ["check", "content", "container", "sticker"],
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
        <UpNextHeader view={props.view} />
        {opts.columnHeaders[0]() && <ListColumnHeaders />}
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
      </section>
    </ListOptionsContext.Provider>
  );
};
