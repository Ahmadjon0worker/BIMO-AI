/** Crossing the panel should not expand it. Explicit clicks remain immediate. */
export class HoverDwell {
  private timer: ReturnType<typeof setTimeout>|null=null;
  private wake:()=>void;
  private delay:number;
  constructor(wake:()=>void, delay=400){this.wake=wake;this.delay=delay;}
  enter(){this.leave();this.timer=setTimeout(()=>{this.timer=null;this.wake();},this.delay);}
  leave(){if(this.timer!==null)clearTimeout(this.timer);this.timer=null;}
}
