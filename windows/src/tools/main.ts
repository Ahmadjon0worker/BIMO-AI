import "./tools.css";
import "../effects/liquid.css";
import { installLiquidSurfaces } from "../effects/liquid";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { resolveLanguage, setLanguage, systemLanguages } from "../i18n/i18n";
import type { Settings } from "../core/state";
import { buildTools } from "./view";
import { invoke } from "@tauri-apps/api/core";
import { ToolsHandshake } from "../core/tools-handshake";

const view = buildTools();
document.querySelector("#tools-root")!.append(view.el);
const destroyGlass = installLiquidSurfaces(document.querySelector<HTMLElement>("#tools-root")!, "tools");
window.addEventListener("pagehide", destroyGlass, { once: true });
let timer: ReturnType<typeof setTimeout> | null = null;
let visible = false;
let holdGeneration = 0;
const handshake = new ToolsHandshake();
function setVisible(next: boolean) {
  if (next === visible) return;
  if (!next) { holdGeneration++; view.voice.pushToTalk(false); }
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
const ready = Promise.all([
  onEvent<boolean>("tools-visible", next => { handshake.changed(); setVisible(next); }),
  onEvent("tools-default", () => { handshake.changed(); view.setTab("tools"); }),
  onEvent("tools-voice", () => { handshake.changed(); view.setTab("voice"); }),
  onEvent("tools-assistant", () => { handshake.changed(); view.setTab("assistant"); }),
  onEvent<{pressed:boolean}>("voice-push-to-talk", async ({pressed}) => {
    handshake.changed();
    const generation = ++holdGeneration;
    if (!pressed) { view.voice.pushToTalk(false); return; }
    setVisible(true); view.setTab("voice", false);
    await view.voice.refresh();
    if (generation === holdGeneration && visible) view.voice.pushToTalk(true);
  }),
]);
void ready.then(async () => {
  if (IS_TAURI) await handshake.restore(() => invoke("local_ai_tools_snapshot"), state => {
    view.setTab(state.tab, false); setVisible(state.visible);
  });
}).catch(() => {});
void onEvent<Settings>("settings-changed", (settings) => {
  setLanguage(resolveLanguage(settings.language, systemLanguages())); view.sync();
});
window.addEventListener("pagehide", () => { handshake.close(); holdGeneration++; setVisible(false); });
