import styles from "./check.module.css";

interface CheckboxProps {
  checked: boolean;
  onChange: (val: any) => void;
}

export function Checkbox(props: CheckboxProps) {
  return (
    <button
      classList={{
        [styles["check"]]: true,
        [styles["checked"]]: !!props.checked,
      }}
      onMouseDown={(event) => {
        props.onChange(event);
      }}
    >
      <span></span>
    </button>
  );
}
