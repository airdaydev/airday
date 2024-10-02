import { DoneView, ViewNode, DataView } from "./state";
import { List } from "../list/list";
import { Done } from "../list/done";
import { Match, Switch } from "solid-js";

interface ViewProps {
  view: ViewNode;
}

export function DataViewComponent(props: ViewProps) {
  return (
    <Switch>
      <Match when={props.view instanceof DoneView}>
        <Done view={props.view} />
      </Match>
      <Match when={props.view instanceof DataView}>
        <List view={props.view} />
      </Match>
    </Switch>
  );
}
