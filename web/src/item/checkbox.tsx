import styles from "./check.module.css";
import DoneSVG from "../icons/check-hand.svg?component-solid";

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
      >
        {props.checked && <DoneSVG />}
      </div>
    </button>
  );
}
