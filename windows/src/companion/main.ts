import "./pointer.css";
import "../effects/liquid.css";
import { onEvent } from "../core/bridge";
import { invoke } from "@tauri-apps/api/core";
import { h } from "../views/dom";
import { createMoshiAvatar } from "../mochi/avatar";
import { installLiquidSurfaces } from "../effects/liquid";

const avatar = createMoshiAvatar("codex", "Moshi tugmani ko‘rsatmoqda", 88);
const label = h("div", { class: "pointer-label", role: "status", "aria-live": "polite" });
const tip = h("div", { class: "pointer-tip" });
const el = h("div", { class: "pointer-body" }, label, avatar.el, tip);
document.querySelector("#companion-root")!.append(el);
const dispose = installLiquidSurfaces(el, "tools");
type Target={label:string;above:boolean;tip_x:number};
function target(p:Target){
  label.textContent = p.label;
  el.dataset.above = String(p.above);
  tip.style.left = `${Math.max(0, Math.min(164, p.tip_x))}px`;
  avatar.setState("thinking");
}
function visibility(shown:boolean){avatar.setVisible(shown);el.hidden=!shown;}
void Promise.all([onEvent<Target>("companion-target",target),onEvent<boolean>("companion-visible",visibility)]).then(async()=>{
  const s=await invoke<{visible:boolean;target:Target|null}>("companion_snapshot");if(s.target)target(s.target);visibility(s.visible===true);
}).catch(()=>visibility(false));
el.hidden = true;
window.addEventListener("pagehide", () => { avatar.destroy(); dispose(); }, { once: true });
