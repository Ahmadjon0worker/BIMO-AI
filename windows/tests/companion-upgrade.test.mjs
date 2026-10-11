import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {parseCompanionPoint} from '../src/core/companion.ts';
import {parseBrainCards,parseMemories} from '../src/core/assistant.ts';
import {HoverDwell} from '../src/core/hover-dwell.ts';
test('pointer preserves negative-monitor pixels and literal labels without executable fields',()=>{
  assert.deepEqual(parseCompanionPoint({x:-900,y:120,label:'Saqlash',script:'ignored'}),{x:-900,y:120,label:'Saqlash',reduced_motion:false});
  for(const x of [NaN,Infinity,'1',100001])assert.throws(()=>parseCompanionPoint({x,y:1,label:'x'}));
  assert.throws(()=>parseCompanionPoint({x:1,y:1,label:'a\nb'}));
});
test('provider and memory boundaries reject malformed success and bound display text',()=>{
  assert.throws(()=>parseBrainCards({ok:false,brains:[]}));
  assert.equal(parseBrainCards({ok:true,brains:[{id:'codex',label:'Codex',ready:true,installed:true,reason:'Tayyor'}]})[0].ready,true);
  assert.throws(()=>parseMemories({ok:true,items:[{id:'a'}]}));
});
test('crossing the panel cancels hover expansion; sustained hover opens once',()=>{
  mock.timers.enable({apis:['setTimeout']});let opened=0;const h=new HoverDwell(()=>opened++);
  try{h.enter();mock.timers.tick(399);h.leave();mock.timers.tick(500);assert.equal(opened,0);
    h.enter();mock.timers.tick(400);assert.equal(opened,1);mock.timers.tick(1000);assert.equal(opened,1);
  }finally{h.leave();mock.timers.reset();}
});
