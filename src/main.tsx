import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./styles.css";
import { App } from "./App";

const container = document.getElementById("app");
if (container) {
  createRoot(container).render(<App />);
}
