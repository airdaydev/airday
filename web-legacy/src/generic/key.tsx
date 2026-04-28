import styles from "./generic.module.css";

interface KeyProps {
  key: string;
}

export const Key = (props: KeyProps) => {
  return (
    <span
      classList={{
        [styles["key"]]: true,
        key: true,
      }}
    >
      {props.key}
    </span>
  );
};
