import styles from "./check.module.css";

interface CheckboxProps {
  checked: boolean;
  onChange: (val: any) => void;
}

export function Checkbox(props: CheckboxProps) {
  return (
    <button
      class={styles["check-button"]}
      onMouseDown={(event) => {
        props.onChange(event);
      }}
    >
      <div
        classList={{
          [styles["check"]]: true,
          [styles["checked"]]: !!props.checked,
        }}
      ></div>
    </button>
  );
}
