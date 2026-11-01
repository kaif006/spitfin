import { h, render } from "preact";
import { App } from "./ui/App";
import { audio } from "./audio";

audio.installUnlock();
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t instanceof Element && t.closest("button")) audio.play("click");
});

const root = document.createElement("div");
root.id = "app";
document.body.appendChild(root);
render(h(App, null), root);
