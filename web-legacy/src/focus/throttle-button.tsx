import {
  createSignal,
  onCleanup,
  onMount,
  ParentProps,
  useContext,
} from "solid-js";
import styles from "./focus.module.css";
import { sessionContext } from "../store/context";

interface ThrottleButtonProps {
  children: ParentProps;
  action: () => void;
}

export const ThrottleButton = (props: ThrottleButtonProps) => {
  const session = useContext(sessionContext);
  const [progress, setProgress] = createSignal(0);
  const [isHolding, setIsHolding] = createSignal(false);
  let intervalId;

  const startHold = () => {
    if (isHolding()) return;
    setIsHolding(true);
    if (progress() === 0) setProgress(10);
    intervalId = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(intervalId);
          setIsHolding(false);
          props.action();
          return 100;
        }
        return prev + 10;
      });
    }, 100);
  };

  const endHold = () => {
    if (isHolding()) {
      clearInterval(intervalId);
      setIsHolding(false);
      setProgress(0);
    }
  };

  let isEscDown = true;

  const throttleQuit = (event: KeyboardEvent) => {
    if (event.type === "keydown" && event.key === "Escape") {
      isEscDown = true;
      startHold();
    }
    if (event.type === "keyup" && event.key === "Escape") {
      isEscDown = false;
      endHold();
    }
  };

  onMount(() => {
    window.addEventListener("keydown", throttleQuit);
    window.addEventListener("keyup", throttleQuit);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", throttleQuit);
    window.removeEventListener("keyup", throttleQuit);
    if (isEscDown) {
      session.viewState.keyboard.stopKeys.add("Escape");
      window.addEventListener(
        "keyup",
        () => {
          session.viewState.keyboard.stopKeys.delete("Escape");
        },
        { once: true },
      );
    }
  });

  return (
    <button
      onMouseDown={startHold}
      onMouseUp={endHold}
      onMouseLeave={endHold}
      onKeyUp={(event) => {
        if (event.key === "Escape") {
          endHold();
        }
      }}
      class={styles["focus-button"]}
    >
      {props.children}
      <div
        class={styles["overlay-container"]}
        style={{
          transition: "width 0.1s linear",
          width: `${progress()}%`,
        }}
      >
        <div class={styles["focus-button-alt"]}>{props.children}</div>
      </div>
    </button>
  );
};
