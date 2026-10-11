import "./tools.css";
import { Bridge, onEvent } from "../core/bridge";
import { resolveLanguage, setLanguage, systemLanguages } from "../i18n/i18n";
import type { Settings } from "../core/state";
import { buildTools } from "./view";

const view = buildTools();
document.querySelector("#tools-root")!.append(view.el);
let timer: ReturnType<typeof setTimeout> | null = null;
let visible = false;
function setVisible(next: boolean) {
  visible = next;
  view.setVisible(next);
  if (timer != null) clearTimeout(timer);
  timer = null;
  if (visible) void poll();
}
async function poll() {
  await view.refresh();
  if (visible && timer == null) timer = setTimeout(() => { timer = null; void poll(); }, 3000);
}
void Bridge.boot().then((boot) => {
  if (boot) setLanguage(resolveLanguage(boot.settings.language, systemLanguages()));
  view.sync();
});
void onEvent<boolean>("tools-visible", setVisible);
void onEvent("tools-voice", () => view.setTab("voice"));
void onEvent<Settings>("settings-changed", (settings) => {
  setLanguage(resolveLanguage(settings.language, systemLanguages())); view.sync();
});
window.addEventListener("pagehide", () => setVisible(false));
