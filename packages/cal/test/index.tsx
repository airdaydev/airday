/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import { Cal } from "../src/cal.tsx";

const root = document.getElementById("root");

render(() => <Cal />, root!);
