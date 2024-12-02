import { Show } from "solid-js";
import { useTreeContext } from "./dnd-context";

export const Placeholder = (props: {
  backdrop?: boolean;
  debugText?: string;
}) => {
  const treeContext = useTreeContext();
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
