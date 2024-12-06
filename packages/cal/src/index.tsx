/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import App from "./cal.tsx";

const root = document.getElementById("root");

render(() => <App />, root!);
