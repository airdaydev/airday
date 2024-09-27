import styles from "./generic.module.css";

interface KeyProps {
  key: string;
}

export const Key = (props: KeyProps) => {
  return <span class={styles["key"]}>{props.key}</span>;
};
