/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import { Cal } from "../src/cal.tsx";

const root = document.getElementById("root");

render(
  () => (
    <div id="app-container">
      <h1>@air-app/cal demo</h1>
      <Cal />
    </div>
  ),
  root!,
);
