import checkStyles from "./check.module.css";

interface CheckboxProps {
  checked: boolean;
  onChange: (val: any) => void;
}

export function Checkbox(props: CheckboxProps) {
  return (
    <label class={checkStyles["check"]}>
      <input
        type="checkbox"
        checked={!!props.checked}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onChange={props.onChange}
        onDblClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      ></input>
      <span></span>
    </label>
  );
}
