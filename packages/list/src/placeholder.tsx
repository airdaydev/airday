import { Show, useContext } from "solid-js";
import { TreeContext, SolidListContext } from "./dnd-context";

export const Placeholder = (props: {
  backdrop?: boolean;
  debugText?: string;
}) => {
  const treeContext = useContext<TreeContext>(SolidListContext);
  return (
    <div
      classList={{
        placeholder: true,
        backdrop: props.backdrop,
        ...(treeContext.placeholderStyle && {
          [treeContext.placeholderStyle]: true,
        }),
      }}
      style={{
        "max-height": `${treeContext.itemHeight}px`,
      }}
    >
      <Show when={!!props.debugText}>{props.debugText}</Show>
    </div>
  );
};
