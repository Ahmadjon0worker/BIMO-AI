import { h } from "../views/dom";
import { Bridge } from "../core/bridge";
import { parseBrainCards,parseMemories } from "../core/assistant";
import { createMoshiAvatar } from "../mochi/avatar";
import { createThinkingOrb } from "../effects/thinking-orb";

export function buildAssistant(call:(name:string,args:Record<string,unknown>)=>Promise<unknown>=Bridge.localAIToolboxCall){
  let visible=false,pending=false,generation=0,refreshBusy=false,pendingKind:"brain"|"memory"|null=null;
  let cancelPending:Promise<unknown>=Promise.resolve();
  const avatar=createMoshiAvatar("codex","Moshi yordamchisi",64);
  const orb=createThinkingOrb({size:20,theme:"dark",accent:"#a7ebd2",visible:false});
  const notice=h("p",{role:"status","aria-live":"polite",class:"notice"});
  const cards=h("div",{class:"assistant-brains"});
  const engine=h("select",{id:"assistant-engine"},...[["auto","Tayyor AI’ni avtomatik tanlash"],["broker","Ollama / Gemini / Groq"],["codex","Codex CLI"],["claude","Claude Code CLI"]].map(([value,text])=>h("option",{value,text})));
  const prompt=h("textarea",{id:"assistant-prompt",rows:3,maxlength:4000,placeholder:"Savolingizni o‘zbekcha yozing…"});
  const reply=h("pre",{id:"assistant-reply",class:"toolbox-output","aria-live":"polite"});
  const memories=h("div",{class:"assistant-memories"});
  const fact=h("textarea",{id:"assistant-memory",rows:2,maxlength:500,placeholder:"Masalan: javoblarni o‘zbekcha va qisqa yozing"});
  const activity=h("div",{class:"assistant-activity"});
  const label=(caption:string,input:HTMLElement)=>h("label",{class:"field",for:input.id},h("span",{text:caption}),input);
  const ask=h("button",{id:"assistant-ask",text:"Moshi’dan so‘rash",onclick:()=>void askBrain()});
  const cancel=h("button",{id:"assistant-cancel",class:"secondary",text:"Javobni to‘xtatish",onclick:()=>stop()});
  const remember=h("button",{id:"assistant-remember",text:"Eslab qolish",onclick:()=>void mutate("assistant_memory_remember",{text:fact.value,source:"user"})});
  const refreshButton=h("button",{class:"secondary",text:"Holatni yangilash",onclick:()=>void refresh()});
  const el=h("section",{id:"assistant-panel",role:"tabpanel"},
    h("section",{class:"card"},h("div",{class:"liquid-status-line"},avatar.el,h("div",{},h("h2",{text:"Moshi yordamchisi"}),h("p",{class:"muted",text:"AI ulanishi, mahalliy xotira va bajarilgan amallar"})),orb.el),notice,cards,
      label("Javob beruvchi AI",engine),label("Savol",prompt),h("div",{class:"actions"},ask,cancel,refreshButton),reply,
      h("p",{class:"hint",text:"Bu bo‘lim savolga javob beradi. Telegram uchun «Shaxsiy Telegram» yoki «Ovoz», tugmani ko‘rsatish va qadamlarni tekshirish uchun «Desktop» bo‘limini oching."})),
    h("div",{class:"columns"},h("section",{class:"card"},h("h2",{text:"Moshi xotirasi"}),
      h("p",{class:"muted",text:"Faqat o‘zingiz kiritgan afzalliklar. Ushbu Windows akkauntida shifrlanadi. Parol, API kalit yoki kirish kodlarini kiritmang."}),label("Eslab qolinadigan afzallik",fact),h("div",{class:"actions"},remember),memories),
      h("section",{class:"card"},h("h2",{text:"Amallar tarixi"}),h("p",{class:"muted",text:"Amal turi, natijasi va davomiyligi. Xabar matni va terminal skripti tarixga yozilmaydi."}),activity)));
  function sync(){ask.disabled=pending||!visible;remember.disabled=pending||!visible;engine.disabled=pending;cancel.disabled=pendingKind!=="brain";avatar.setVisible(visible);avatar.setState(pending?"thinking":"idle");orb.setVisible(visible);orb.setState(pending?"solving":"breathing");}
  async function refresh(){if(!visible||pending||refreshBusy)return;const current=generation;refreshBusy=true;
    try{const s=await call("assistant_status",{});if(current!==generation||!visible)return;
      cards.replaceChildren(...parseBrainCards(s).map(b=>h("article",{class:"assistant-brain", "data-ready":String(b.ready)},h("strong",{text:b.label}),h("span",{text:b.ready===null?"So‘rovda tekshiriladi":b.ready?"Tayyor":b.installed?"Ulanish kerak":"O‘rnatilmagan"}),h("small",{text:b.reason}))));
      const m=await call("assistant_memory_list",{});if(current!==generation||!visible)return;
      const items=parseMemories(m);memories.replaceChildren(...items.map(i=>h("article",{class:"assistant-memory-item"},h("p",{text:i.text}),h("small",{text:`Manba: ${i.source || "user"}`}),h("button",{class:"secondary",text:"Unutish",onclick:()=>void mutate("assistant_memory_forget",{id:i.id})}))));
      if(!items.length)memories.append(h("p",{class:"muted",text:"Hozircha eslab qolingan afzallik yo‘q."}));
      const log=await call("assistant_activity",{limit:20}) as Record<string,unknown>;if(current!==generation||!visible)return;
      const rows=Array.isArray(log.items)?log.items.filter((item:unknown)=>item!==null&&typeof item==="object"):[];
      const resultLabels:Record<string,string>={completed:"Bajarildi",failed:"Xato",cancelled:"To‘xtatildi",unknown:"Natija noma’lum"};
      activity.replaceChildren(...rows.map((raw:unknown)=>{const i=raw as Record<string,unknown>;const state=String(i.state||i.status||i.outcome||"unknown");return h("p",{class:"assistant-activity-row",text:`${String(i.action||i.name||i.tool||"Amal").slice(0,80)} · ${resultLabels[state]||state.slice(0,40)} · ${Number(i.elapsed_ms||i.duration_ms||0)} ms`});}));
      notice.textContent="Moshi holati yangilandi.";
    }catch(e){if(current===generation&&visible)notice.textContent=e instanceof Error?e.message:String(e);}
    finally{refreshBusy=false;if(current!==generation&&visible&&!pending)void refresh();}
  }
  async function mutate(name:string,args:Record<string,unknown>){if(pending||!visible)return;const current=++generation;pending=true;pendingKind="memory";sync();
    try{const r=await call(name,args) as Record<string,unknown>;if(current!==generation||!visible)return;if(r.ok!==true)throw new Error(typeof r.error==="string"?r.error:"Xotira saqlanmadi");if(name==="assistant_memory_remember")fact.value="";notice.textContent="Xotira yangilandi.";}
    catch(e){if(current===generation&&visible)notice.textContent=e instanceof Error?e.message:String(e);}finally{if(current===generation){pending=false;pendingKind=null;sync();if(visible)void refresh();}}
  }
  async function askBrain(){if(pending||!visible||!prompt.value.trim())return;const current=++generation;pending=true;pendingKind="brain";reply.textContent="Moshi javob tayyorlayapti…";sync();
    try{await cancelPending;if(current!==generation||!visible)return;
      const r=await call("assistant_brain_reply",{prompt:prompt.value.trim(),engine:engine.value}) as Record<string,unknown>;
      if(current!==generation||!visible)return;
      if(r.ok!==true||typeof r.reply!=="string")throw new Error(typeof r.error==="string"?r.error:"AI javob bermadi");
      reply.textContent=r.reply;notice.textContent=`${String(r.provider||"AI")} · ${Number(r.elapsed_ms||0)} ms`;
    }catch(e){if(current===generation&&visible)reply.textContent=e instanceof Error?e.message:String(e);}finally{if(current===generation){pending=false;pendingKind=null;sync();}}
  }
  function stop(){generation++;if(pendingKind==="brain"){cancelPending=cancelPending.catch(()=>{}).then(()=>call("assistant_cancel",{})).catch(()=>{});reply.textContent="Javob to‘xtatildi.";}pending=false;pendingKind=null;sync();}
  sync();window.addEventListener?.("pagehide",()=>{stop();avatar.destroy();orb.destroy();},{once:true});
  return {el,refresh,stop,sync,setVisible(next:boolean){if(next===visible)return;visible=next;if(!next)stop();sync();}};
}
