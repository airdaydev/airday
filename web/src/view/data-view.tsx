import { DoneView, ViewNode, DataView, UpNextView } from "./state";
import { List } from "../list/list";
import { Done } from "../list/done";
import { Match, Switch } from "solid-js";
import { UpNext } from "../list/up-next";

interface ViewProps {
  view: ViewNode;
}

export function DataViewComponent(props: ViewProps) {
  return (
    <Switch>
      <Match when={props.view instanceof DoneView}>
        <Done view={props.view} />
      </Match>
      <Match when={props.view instanceof UpNextView}>
        <UpNext view={props.view} />
      </Match>
      <Match when={props.view instanceof DataView}>
        <List view={props.view} />
      </Match>
    </Switch>
  );
}
