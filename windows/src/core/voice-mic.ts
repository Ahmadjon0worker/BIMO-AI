import { pcmWav } from "./voice";

/** Explicit per-window recording. Closing/hiding stops tracks, including a late permission result. */
export class VoiceMic {
  private stream: MediaStream | null = null; private context: AudioContext | null = null; private processor: ScriptProcessorNode | null = null;
  private generation=0; private chunks: Float32Array[]=[]; private count=0; private spoke=false; private silence=0; private delivered=false;
  recording=false; level=0; elapsed=0; private finishOnSilence=true; private lastMeter=0;
  private finished:(wav:Uint8Array)=>void; private changed:()=>void;
  constructor(finished:(wav:Uint8Array)=>void, changed:()=>void=()=>{}) {this.finished=finished;this.changed=changed;}
  async start(options: { finishOnSilence?: boolean } = {}): Promise<void> {
    this.stop(); const generation=this.generation; this.finishOnSilence=options.finishOnSilence !== false;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Mikrofon mavjud emas. Windows mikrofon ruxsatini tekshiring.");
    const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
    this.stream=stream;
    try {
      const context=this.context=new AudioContext(); await context.resume();
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());void context.close().catch(()=>{});return;}
      const source=context.createMediaStreamSource(stream), processor=this.processor=context.createScriptProcessor(4096,1,1),mute=context.createGain();mute.gain.value=0;
      source.connect(processor);processor.connect(mute);mute.connect(context.destination);this.recording=true;this.changed();
      processor.onaudioprocess=e=>{
        if(generation!==this.generation || !this.recording || this.delivered)return;
        const chunk=e.inputBuffer.getChannelData(0).slice(); let sum=0;for(const v of chunk)sum+=v*v;this.level=Math.sqrt(sum/chunk.length);
        const remaining=Math.floor(context.sampleRate*15)-this.count;
        if(remaining>0){const clipped=chunk.subarray(0,remaining);this.chunks.push(clipped);this.count+=clipped.length;}
        this.elapsed=this.count/context.sampleRate;
        if(this.level>0.012){this.spoke=true;this.silence=0;}else this.silence+=chunk.length/context.sampleRate;
        if(this.count>=context.sampleRate*15 || this.finishOnSilence && this.spoke && this.silence>=1.15)this.finish();
        else if(performance.now()-this.lastMeter>=80){this.lastMeter=performance.now();this.changed();}
      };
    } catch(e){if(generation===this.generation)this.stop();else stream.getTracks().forEach(t=>t.stop());throw e;}
  }
  finish(){
    if(!this.recording || this.delivered)return;this.delivered=true;
    const rate=this.context!.sampleRate, samples=new Float32Array(this.count);let offset=0;
    for(const chunk of this.chunks){samples.set(chunk,offset);offset+=chunk.length;}
    const spoke=this.spoke;this.stop();if(spoke && samples.length>=rate*0.25)this.finished(pcmWav(samples,rate));
  }
  stop(){this.generation++;this.recording=false;this.level=0;if(this.processor){this.processor.onaudioprocess=null;this.processor.disconnect();this.processor=null;}
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;const context=this.context;this.context=null;if(context)void context.close().catch(()=>{});
    this.chunks=[];this.count=0;this.spoke=false;this.silence=0;this.delivered=false;this.elapsed=0;this.lastMeter=0;this.changed();}
}
