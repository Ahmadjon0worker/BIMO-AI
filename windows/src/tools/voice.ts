import { h } from "../views/dom";
import { Bridge, onEvent } from "../core/bridge";
import { VoiceController, parseVoiceIntent, voiceCommandText, type VoiceLanguage, type VoiceTransport } from "../core/voice";
import { VoiceMic } from "../core/voice-mic";
import { parseAccountChatPage } from "../core/telegram-account";
import { parseTelegramCommand, TelegramActionController, telegramExplicitReviewRequested } from "../core/telegram-command";
import { parseToolOutput, parseToolPlan, type TerminalShell } from "../core/toolbox";
import { createThinkingOrb } from "../effects/thinking-orb";
import { SentenceSpeechQueue, createWavSpeechAdapter } from "../core/speech-queue";

const TRANSPORT: VoiceTransport = {status:()=>Bridge.localAIVoiceStatus(),transcribe:a=>Bridge.localAIVoiceTranscribe(a),cancel:()=>Bridge.localAIVoiceCancel()};
export function buildVoice(navigate:(tab:"account"|"toolbox"|"desktop")=>void, prefill:(shell:TerminalShell,script:string)=>void, transport:VoiceTransport=TRANSPORT){
  const orb=createThinkingOrb({size:20,theme:"dark",accent:"#a7ebd2",visible:false});
  let visible=false,generation=0,runTicket=0,actionBusy=false,brainPending=false,loop=false,micRequest=0,micPending=false,held=false;
  let brainCancellation:Promise<unknown>=Promise.resolve();
  const controller=new VoiceController(transport,sync);
  const telegram=new TelegramActionController({send:id=>Bridge.localAIAccountSend(id),cancel:id=>Bridge.localAIAccountCancelDraft(id)},sync);
  const notice=h("p",{id:"voice-status",role:"status","aria-live":"polite",class:"notice"});
  const result=h("pre",{id:"voice-result",class:"toolbox-output","aria-live":"polite"});
  const text=h("textarea",{id:"voice-command",rows:3,maxlength:4000,placeholder:"Masalan: shu chatga salom yubor"});
  const language=h("select",{id:"voice-language"},h("option",{value:"uz",text:"O‘zbekcha"}),h("option",{value:"ru",text:"Русский"}),h("option",{value:"en",text:"English"}));language.value="uz";
  const wake=h("input",{id:"voice-wake",type:"checkbox"}),spoken=h("input",{id:"voice-spoken",type:"checkbox"}),direct=h("input",{id:"voice-direct",type:"checkbox"});direct.checked=true;
  const recipient=h("select",{id:"voice-recipient"},h("option",{value:"",text:"Telegram chatini tanlang yoki @username yozing"}));
  const mic=new VoiceMic(wav=>void recognize(wav),sync);
  const speech=new SentenceSpeechQueue(createWavSpeechAdapter(args=>Bridge.localAIVoiceSpeak(args)),sync);
  const record=h("button",{id:"voice-record",text:"🎙 Gapirish",onclick:()=>void start()});
  const hold=h("button",{id:"voice-hold",type:"button",text:"🎙 Bosib gapiring","aria-pressed":"false",style:"touch-action:none;user-select:none"});
  const waveformBars=Array.from({length:9},()=>h("i",{style:"display:block;width:5px;height:4px;border-radius:4px;background:currentColor"}));
  const waveform=h("div",{id:"voice-waveform","aria-hidden":"true",style:"display:flex;align-items:center;gap:4px;height:28px;color:#a7ebd2"},...waveformBars);
  const recordingProgress=h("progress",{id:"voice-progress",max:15,value:0,"aria-label":"Yozuv davomiyligi, eng ko‘pi 15 soniya"});
  const recordingTime=h("span",{id:"voice-time",class:"hint",text:"0.0 / 15 s"});
  const recordingMeter=h("div",{id:"voice-meter",class:"actions",hidden:true},waveform,recordingProgress,recordingTime);
  const finish=h("button",{id:"voice-finish",class:"secondary",text:"Gapirdim",onclick:()=>mic.finish()});
  const cancel=h("button",{id:"voice-cancel",class:"secondary",text:"Ovozni to‘xtatish",onclick:()=>stop()});
  const execute=h("button",{id:"voice-execute",text:"Buyruqni bajarish",onclick:()=>void run(text.value)});
  const send=h("button",{id:"voice-send",text:"Tanlangan xabarni yuborish",onclick:()=>void sendPreview()});
  const check=h("button",{id:"voice-check",class:"secondary",text:"Telegram natijasini tekshirdim",onclick:()=>telegram.acknowledgeUnknown()});
  const load=h("button",{id:"voice-chats",class:"secondary",text:"Telegram chatlarini yuklash",onclick:()=>void loadChats()});
  const refresh=h("button",{class:"secondary",text:"Ovoz holatini tekshirish",onclick:()=>void controller.refresh()});
  const label=(caption:string,input:HTMLElement)=>h("label",{class:"field",for:input.id},h("span",{text:caption}),input);
  const checkbox=(caption:string,input:HTMLElement)=>h("label",{class:"check",for:input.id},input,h("span",{text:caption}));
  const el=h("section",{id:"voice-panel",role:"tabpanel",class:"card"},h("div",{class:"liquid-status-line"},orb.el,h("h2",{text:"Ovozli boshqaruv"})),
    h("p",{class:"muted",text:"Whisper nutqni shu Windows kompyuterda taniydi. Ovoz yozuvi saqlanmaydi. Telegram, CMD va GitHub buyruqlari mavjud vositalarga ulanadi. Oddiy savol tanlangan AI orqali javoblanadi."}),
    h("p",{id:"voice-quality-note",class:"notice",text:"Tilga mos model avtomatik tanlanadi. Ismlar, username va shovqinli nutqda xato bo‘lishi mumkin: «Eshitilgan buyruq» matnini tekshiring va kerak bo‘lsa tahrirlang. Telegram xabarini oldin ko‘rish uchun «Aniq Telegram yuborish buyrug‘ini darhol yuborish» belgisini o‘chiring."}),notice,
    h("div",{class:"voice-options"},label("Nutq tili",language),label("Telegram qabul qiluvchisi",recipient)),h("div",{class:"actions"},load,refresh),
    checkbox("Davomli tinglash: «OK Moshi» bilan boshlangan buyruqlar",wake),
    checkbox("Javobni mahalliy ovozda o‘qish (eSpeak NG)",spoken),
    checkbox("Aniq Telegram yuborish buyrug‘ini darhol yuborish",direct),
    h("div",{class:"actions voice-record-row"},record,hold,finish,cancel),recordingMeter,
    h("p",{class:"hint",text:"«Bosib gapiring»ni yoki Ctrl+Shift+Space’ni ushlab gapiring; qo‘yib yuborsangiz yozuv taniladi. «Gapirish» rejimida 1 soniya sukut ham yakunlaydi. Eng ko‘pi 15 soniya. Yangi gapirish oldingi AI ovozini uzadi. Oyna yashirilsa yoki Stop bosilsa mikrofon o‘chadi. Windows → Privacy & security → Microphone’da desktop apps ruxsatini yoqing."}),
    label("Eshitilgan buyruq — tahrirlash ham mumkin",text),h("div",{class:"actions"},execute,send,check),result,
    h("details",{},h("summary",{text:"Buyruq namunalari — lotin va kirill"}),h("p",{text:"Panelni och · Панелни оч · Panelni ixcham qil · Панелни ихчам қил · Sozlamalarni och · Созламаларни оч · Studioni och · Telegramni och · Shu chatga salom yubor · Шу чатга салом юбор · GitHub holatini ko‘rsat · Repolarimni ko‘rsat · Soat necha · Windows versiyasini ko‘rsat · CMD: ver · Hammasini to‘xtat · Ҳаммасини тўхтат"}),
      h("p",{class:"hint",text:"CMD/PowerShell matni muharrirga tushadi; uni mavjud «Run» tugmasi bilan bajaring. AI murakkab vazifaga reja tayyorlaydi. Ovoz xato tanishi mumkin: qabul qiluvchini aniq tanlang va kerak bo‘lsa darhol yuborishni o‘chiring."})));
  wake.addEventListener("change",()=>stop());
  recipient.addEventListener("change",()=>stop());
  language.addEventListener("change",()=>stop());
  spoken.addEventListener("change",()=>{if(!spoken.checked)speech.cancel();});
  hold.addEventListener("pointerdown",event=>{event.preventDefault();hold.setPointerCapture?.((event as PointerEvent).pointerId);void pushToTalk(true);});
  for(const event of ["pointerup","pointercancel","lostpointercapture","blur"])hold.addEventListener(event,()=>void pushToTalk(false));
  hold.addEventListener("keydown",event=>{const key=(event as KeyboardEvent).key;if(key===" "||key==="Enter"){event.preventDefault();void pushToTalk(true);}});
  hold.addEventListener("keyup",event=>{const key=(event as KeyboardEvent).key;if(key===" "||key==="Enter"){event.preventDefault();void pushToTalk(false);}});
  window.addEventListener?.("pagehide",()=>{stop();orb.destroy();},{once:true});
  function cancelBrain(){if(brainPending){brainPending=false;brainCancellation=brainCancellation.then(()=>Bridge.localAIToolboxCall("assistant_cancel",{})).catch(()=>{});}}
  function stop(){generation++;cancelBrain();micRequest++;micPending=false;held=false;loop=false;actionBusy=false;mic.stop();controller.invalidate();telegram.invalidate();speech.cancel();sync();}
  function halt(){stop();if(controller.status)controller.status.halted=true;sync();}
  async function start(holdMode=false){
    if(!visible || actionBusy&&!brainPending || telegram.snapshot.pending || micPending || mic.recording || !controller.status?.available || controller.status.halted)return;
    generation++;cancelBrain();actionBusy=false;controller.invalidate();speech.cancel();
    void Bridge.voiceBargeIn().catch(()=>{});
    const current=generation,attempt=++micRequest;micPending=true;loop=!holdMode&&wake.checked;sync();
    try{await mic.start({finishOnSilence:!holdMode});if(current===generation && attempt===micRequest && visible && mic.recording){controller.error="";sync();}}
    catch(e){if(current!==generation || attempt!==micRequest || !visible)return;controller.error=e instanceof Error?e.message:String(e);loop=false;sync();}
    finally{if(attempt===micRequest){micPending=false;if(!mic.recording)held=false;sync();}}
  }
  async function pushToTalk(pressed:boolean){
    if(pressed){if(held || !visible || actionBusy&&!brainPending || telegram.snapshot.pending || mic.recording || micPending || !controller.status?.available || controller.status.halted)return;held=true;await start(true);}
    else if(held){held=false;loop=false;if(mic.recording)mic.finish();else if(micPending){micRequest++;micPending=false;mic.stop();}sync();}
  }
  async function sendPreview(){await telegram.send();showSendResult();sync();}
  function showSendResult(){
    if(telegram.snapshot.result?.status==="sent")result.textContent="Telegram xabari yuborildi.";
    else if(telegram.snapshot.result?.status==="unknown")result.textContent="Yuborish natijasi noma’lum. Telegramni tekshiring; qayta yuborilmadi.";
    else if(telegram.snapshot.error)result.textContent=telegram.snapshot.error;
  }
  async function recognize(wav:Uint8Array){
    const current=generation,query=await controller.transcribe(wav,language.value as VoiceLanguage);
    if(current!==generation || !visible)return;
    if(query){text.value=query;const command=voiceCommandText(query,loop&&wake.checked);if(command)await run(command);else result.textContent="Wake iborasi aytilmadi; buyruq bajarilmadi.";}
    else result.textContent=controller.error||"Nutq topilmadi. Mikrofonni yaqinroq tutib, qayta gapiring.";
    if(current===generation && visible && loop && !controller.error && !telegram.snapshot.preview && telegram.snapshot.result?.status!=="unknown")await start();
  }
  async function loadChats(){const current=generation;load.disabled=true;try{const page=parseAccountChatPage(await Bridge.localAIAccountChats());if(current!==generation || !visible)return;
    const selected=recipient.value;recipient.replaceChildren(h("option",{value:"",text:"Telegram chatini tanlang yoki @username yozing"}),...page.chats.filter(c=>c.can_send).map(c=>h("option",{value:c.chat_id,text:`${c.title}${c.username?` · @${c.username}`:""}`})));recipient.value=page.chats.some(c=>c.chat_id===selected && c.can_send)?selected:"";
  }catch(e){if(current===generation)result.textContent=e instanceof Error?e.message:String(e);}finally{load.disabled=false;}}
  async function speak(message:string,current:number){
    if(!spoken.checked || !controller.status?.tts_available || !visible || current!==generation)return;
    await speech.speak(message,language.value as VoiceLanguage);
    if(current===generation && speech.state.error){controller.error=speech.state.error;sync();}
  }
  async function run(query:string){
    if(!visible || actionBusy || controller.busy || telegram.snapshot.pending || !query.trim())return;
    if(controller.status?.halted){result.textContent="LocalAI to‘xtatilgan. Panelda rejimni tanlang, keyin ovoz holatini yangilang.";return;}
    const intent=parseVoiceIntent(query,!!recipient.value),current=generation,ticket=++runTicket,chat=recipient.value || undefined;
    speech.cancel();void Bridge.voiceBargeIn().catch(()=>{});actionBusy=true;mic.stop();result.textContent="Bajarilmoqda…";sync();
    let speechMessage="Natija ekranda tayyor.";
    try{
      if(intent.kind==="ui"){
        const target=intent.target;
        if(target==="stop"){halt();await Bridge.localAIStop();result.textContent="LocalAI va mikrofon to‘xtatildi.";void controller.refresh();return;}
        if(target==="panel-open" || target==="panel-close")await Bridge.voicePanel(target==="panel-open");
        else if(target==="settings")await Bridge.openSettingsWindow();else if(target==="studio")await Bridge.localAIOpenStudio();
        else {result.textContent="Tanlangan bo‘lim ochildi.";navigate(target==="telegram"?"account":target==="desktop"?"desktop":"toolbox");return;}
        result.textContent="Buyruq bajarildi.";
      }else if(intent.kind==="telegram"){
        const raw=await Bridge.localAIAccountCommand(intent.query,chat);if(current!==generation || !visible){telegram.discardResponse(raw);return;}
        const parsed=parseTelegramCommand(raw);
        if(parsed.kind!=="preview"){result.textContent=parsed.text;return;}
        telegram.accept(parsed);result.textContent=`${parsed.recipient.title}\n${parsed.preview.text}`;
        if(direct.checked && !telegramExplicitReviewRequested(intent.query))await telegram.send();
        if(current!==generation || !visible)return;
        if(telegram.snapshot.result?.status==="sent")result.textContent=`${parsed.recipient.title}: xabar yuborildi.`;
        else if(telegram.snapshot.result?.status==="unknown")result.textContent="Yuborish natijasi noma’lum. Telegramni tekshiring; qayta yuborilmadi.";
        else if(telegram.snapshot.error)result.textContent=telegram.snapshot.error;
      }else if(intent.kind==="github"){
        const raw=await Bridge.localAIToolboxCall("github_action",{operation:intent.operation});if(current!==generation || !visible)return;
        const output=parseToolOutput(raw,"github",intent.operation);result.textContent=output.stdout||output.stderr||`Exit: ${output.exit_code}`;
      }else if(intent.kind==="terminal"){
        result.textContent="Buyruq terminal muharririda tayyor. Bajarish tugmasini bosing.";prefill(intent.shell,intent.script);navigate("toolbox");return;
      }else if(intent.kind==="plan"){
        const raw=await Bridge.localAIToolboxCall("ai_plan",{domain:intent.domain,task:intent.task,shell:"powershell"});if(current!==generation || !visible)return;
        const plan=parseToolPlan(raw,intent.domain);result.textContent=plan.proposal.summary+"\n"+plan.proposal.steps.map(s=>`${s.title}: ${s.description}${s.script?`\n${s.script}`:""}`).join("\n\n");
      }else{
        await brainCancellation;if(current!==generation || !visible)return;
        brainPending=true;sync();
        const raw=await Bridge.localAIToolboxCall("assistant_brain_reply",{prompt:query,engine:"auto"}) as Record<string,unknown>;
        if(current!==generation || !visible)return;
        brainPending=false;
        if(raw?.ok!==true || typeof raw.reply!=="string" || !raw.reply.trim() || raw.reply.length>8000)throw new Error(typeof raw?.error==="string"?raw.error:"AI javobi yaroqsiz yoki provider sozlanmagan. «AI yordamchi» bo‘limida ulanishni tekshiring.");
        result.textContent=raw.reply;speechMessage=raw.reply;
      }
      if(current===generation){actionBusy=false;sync();await speak(intent.kind==="telegram" && telegram.snapshot.result?.status==="sent"?"Xabar yuborildi.":intent.kind==="ui"?"Buyruq bajarildi.":speechMessage,current);}
    }catch(e){if(current===generation && visible)result.textContent=e instanceof Error?e.message:String(e);}
    finally{if(current===generation && ticket===runTicket){brainPending=false;actionBusy=false;sync();}}
  }
  function sync(){
    orb.setVisible(visible);
    orb.setState(micPending?"connecting":mic.recording?"listening":controller.busy?"solving":speech.state.active?"composing":telegram.snapshot.pending?"connecting":actionBusy?"weaving":controller.error?"shaping":"breathing");
    const ready=controller.status,blocked=actionBusy||controller.busy||telegram.snapshot.pending;
    const model=ready?.models_by_language[language.value as VoiceLanguage] || ready?.model;
    notice.textContent=controller.error|| (micPending?"Mikrofon ruxsati kutilmoqda…":mic.recording?`Mikrofon yoqilgan · ${held?"Tugmani qo‘yib yuborganda taniladi":loop&&wake.checked?"OK Moshi bilan buyruq ayting":"Gapiring"}`:controller.busy?"Yozuv tugadi · Nutq mahalliy tanilmoqda…":speech.state.active?`Javob mahalliy ovozda o‘qilmoqda · ${speech.state.remaining} jumla`:ready?.halted?"LocalAI to‘xtatilgan":ready?.available?`Whisper ${model} · O‘zbekcha / Ruscha / English · ${ready.tts_available?"O‘zbekcha ovoz mavjud":"Ovoz javobi mavjud emas"}`:ready?.reason||"Ovoz holatini tekshirish tugmasini bosing.");
    const inputBlocked=actionBusy&&!brainPending||telegram.snapshot.pending||micPending||mic.recording||!visible||!ready?.available||ready.halted;
    record.disabled=inputBlocked;hold.disabled=inputBlocked&&!held;hold.setAttribute("aria-pressed",String(held));finish.disabled=!mic.recording;execute.disabled=blocked||!visible;
    recordingMeter.hidden=!mic.recording;recordingProgress.value=mic.elapsed;recordingTime.textContent=`${mic.elapsed.toFixed(1)} / 15 s`;
    const strength=Math.min(1,mic.level*18);waveformBars.forEach((bar,index)=>{bar.style.height=`${4+strength*(24-Math.abs(index-4)*3)}px`;});
    language.disabled=blocked||mic.recording;recipient.disabled=blocked||mic.recording;send.hidden=!telegram.snapshot.preview;send.disabled=blocked;check.hidden=telegram.snapshot.result?.status!=="unknown";check.disabled=blocked;
  }
  void onEvent("localai-account-invalidated",()=>{stop();recipient.value="";});
  void onEvent("voice-barge-in",()=>speech.cancel());
  sync();return {el,controller,telegram,mic,speech,run,sync,pushToTalk,refresh:()=>controller.refresh(),stop,halt,setVisible(next:boolean){if(next===visible)return;visible=next;if(!next){stop();text.value="";if(telegram.snapshot.result?.status!=="unknown")result.textContent="";}sync();}};
}
