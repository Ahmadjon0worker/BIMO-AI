export interface BrainCard { id:string;label:string;installed:boolean;ready:boolean|null;reason:string }
export interface MemoryItem { id:string;text:string;source:string;created_at:string }
export function parseBrainCards(raw:unknown):BrainCard[]{
  const r=raw as Record<string,unknown>|null;
  if(!r || r.ok!==true || !Array.isArray(r.brains))throw new Error("AI ulanish holati olinmadi");
  return r.brains.slice(0,12).map((v:unknown)=>{const b=v as Record<string,unknown>;
    if(!b || typeof b.id!=="string" || typeof b.label!=="string" || (typeof b.ready!=="boolean" && b.ready!==null))throw new Error("AI ulanish ma’lumoti yaroqsiz");
    return {id:b.id.slice(0,40),label:b.label.slice(0,100),ready:b.ready,installed:b.installed===true,reason:typeof b.detail==="string"?b.detail.slice(0,300):typeof b.reason==="string"?b.reason.slice(0,300):""};
  });
}
export function parseMemories(raw:unknown):MemoryItem[]{
  const r=raw as Record<string,unknown>|null;
  if(!r || r.ok!==true || !Array.isArray(r.items))throw new Error("Xotira olinmadi");
  return r.items.slice(0,100).map((v:unknown)=>{const m=v as Record<string,unknown>;
    if(!m || typeof m.id!=="string" || typeof m.text!=="string")throw new Error("Xotira ma’lumoti yaroqsiz");
    return {id:m.id,text:m.text.slice(0,1000),source:typeof m.source==="string"?m.source.slice(0,100):"",created_at:typeof m.created_at==="string"?m.created_at:""};
  });
}
