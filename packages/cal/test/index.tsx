/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";
import { Cal } from "../src/cal.tsx";

const root = document.getElementById("root");

render(
  () => (
    <div style="width: 100%;height: 100%;">
      <h1>@air-app/cal demo</h1>
      <Cal />
    </div>
  ),
  root!,
);
