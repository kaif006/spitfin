import { h, render } from "preact";
import { App } from "./ui/App";

const root = document.createElement("div");
root.id = "app";
document.body.appendChild(root);
render(h(App, null), root);
