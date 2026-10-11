// Pure pointer/IPC lifetime regressions. No native windows or touch hardware.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PanelDrag} from '../src/island/panel-drag.ts';

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function drain(){for(let i=0;i<16;i++)await Promise.resolve();}
const pointer=(overrides={})=>({pointerId:17,pointerType:'touch',button:0,isPrimary:true,screenX:100,screenY:200,...overrides});
const moved=(x,y,overrides={})=>({pointerId:17,screenX:x,screenY:y,...overrides});
function fixture(overrides={}){
  const calls={begin:[],update:[],end:[],active:[]};
  const sink={
    begin:async(kind)=>{calls.begin.push(kind);return overrides.begin?await overrides.begin(kind):true;},
    update:async(dx,dy)=>{calls.update.push([dx,dy]);return overrides.update?await overrides.update(dx,dy):undefined;},
    end:async(cancelled)=>{calls.end.push(cancelled);return overrides.end?await overrides.end(cancelled):undefined;},
    active:on=>calls.active.push(on),
  };
  return {drag:new PanelDrag(sink),calls};
}

test('only one primary left mouse, touch or pen owns the pointer lifetime',async()=>{
  for(const kind of ['mouse','touch','pen']){
    const {drag,calls}=fixture();
    assert.equal(drag.start(pointer({pointerType:kind})),true);
    assert.equal(drag.active,true);assert.equal(drag.pointerId,17);
    assert.equal(drag.start(pointer({pointerId:18})),false);
    await drag.end();
    assert.deepEqual(calls.begin,[kind]);assert.deepEqual(calls.active,[true,false]);
    assert.equal(drag.active,false);assert.equal(drag.pointerId,null);
  }
});

test('right buttons, secondary pointers, unsupported types and nonfinite coordinates are rejected',async()=>{
  const {drag,calls}=fixture();
  for(const value of [pointer({button:1}),pointer({button:2}),pointer({isPrimary:false}),
    pointer({pointerType:'unknown'}),pointer({screenX:NaN}),pointer({screenY:Infinity})]){
    assert.equal(drag.start(value),false);
  }
  await drain();assert.equal(drag.active,false);assert.deepEqual(calls.begin,[]);assert.deepEqual(calls.active,[]);
});

test('mouse tracking belongs to native polling and never issues frontend move commands',async()=>{
  const {drag,calls}=fixture();drag.start(pointer({pointerType:'mouse'}));
  drag.move(moved(200,300));await drain();drag.move(moved(-400,900));await drag.end();
  assert.deepEqual(calls.begin,['mouse']);assert.deepEqual(calls.update,[]);assert.deepEqual(calls.end,[false]);
});

test('touch jitter begins capture but causes no position updates',async()=>{
  const {drag,calls}=fixture();drag.start(pointer());
  drag.move(moved(102,201));drag.move(moved(99,198));await drain();await drag.end();
  assert.deepEqual(calls.begin,['touch']);assert.deepEqual(calls.update,[]);assert.deepEqual(calls.end,[false]);
});

test('touch movement uses total screen deltas despite changing client coordinates',async()=>{
  const {drag,calls}=fixture();drag.start(pointer({screenX:-500,screenY:100}));await drain();
  drag.move(moved(-480,130,{clientX:5,clientY:6}));await drain();
  drag.move(moved(-460,160,{clientX:-900,clientY:-800}));await drag.end();
  assert.deepEqual(calls.update,[[20,30],[40,60]]);
});

test('the four-pixel movement boundary starts a touch move',async()=>{
  const {drag,calls}=fixture();drag.start(pointer());await drain();
  drag.move(moved(104,200));await drag.end();assert.deepEqual(calls.update,[[4,0]]);
});

test('once movement starts returning to the origin is not suppressed as jitter',async()=>{
  const {drag,calls}=fixture();drag.start(pointer());await drain();
  drag.move(moved(120,190));await drain();drag.move(moved(100,200));await drag.end();
  assert.deepEqual(calls.update,[[20,-10],[0,0]]);
});

test('a touch returned near its origin before begin completes keeps the latest offset',async()=>{
  const begin=deferred();const {drag,calls}=fixture({begin:()=>begin.promise});
  drag.start(pointer());drag.move(moved(150,250));drag.move(moved(101,201));
  begin.resolve(true);await drag.end();assert.deepEqual(calls.update,[[1,1]]);
});

test('moves accumulated during begin coalesce to one latest total delta',async()=>{
  const begin=deferred();const {drag,calls}=fixture({begin:()=>begin.promise});
  drag.start(pointer());drag.move(moved(110,210));drag.move(moved(130,250));drag.move(moved(150,260));
  await drain();assert.deepEqual(calls.update,[]);begin.resolve(true);await drag.end();
  assert.deepEqual(calls.update,[[50,60]]);assert.deepEqual(calls.end,[false]);
});

test('a slow in-flight move is followed only by the latest queued position before end',async()=>{
  const first=deferred();let count=0;const order=[];
  const {drag,calls}=fixture({update:async()=>{count++;order.push('update-'+count);if(count===1)await first.promise;},end:async()=>order.push('end')});
  drag.start(pointer());await drain();drag.move(moved(110,200));await drain();
  drag.move(moved(120,200));drag.move(moved(140,210));
  const ending=drag.end();await drain();assert.deepEqual(calls.update,[[10,0]]);assert.deepEqual(calls.end,[]);
  first.resolve();await ending;
  assert.deepEqual(calls.update,[[10,0],[40,10]]);assert.deepEqual(order,['update-1','update-2','end']);
});

test('pointer release waits for its final offset across prior-reply microtask timing',async()=>{
  // A pointerup can arrive just as the previous IPC reply settles. Vary that
  // event/reply ordering; the native end must follow the final move's reply.
  for(let turns=0;turns<9;turns++){
    const first=deferred(),last=deferred();let updates=0;
    const {drag,calls}=fixture({update:()=>++updates===1?first.promise:last.promise});
    drag.start(pointer());await drain();drag.move(moved(110,210));await drain();
    first.resolve();for(let i=0;i<turns;i++)await Promise.resolve();
    drag.move(moved(140,245));const ending=drag.end();await drain();
    try{
      assert.deepEqual(calls.update,[[10,10],[40,45]],`latest offset missing at timing ${turns}`);
      assert.deepEqual(calls.end,[],`native end overtook final reply at timing ${turns}`);
    }finally{last.resolve();await ending;}
    assert.deepEqual(calls.end,[false]);
  }
});

test('release while begin is pending waits for admission, flushes and ends once',async()=>{
  const begin=deferred();const {drag,calls}=fixture({begin:()=>begin.promise});
  drag.start(pointer());drag.move(moved(125,205));const ending=drag.end();
  await drain();assert.equal(drag.active,true);assert.deepEqual(calls.end,[]);
  assert.equal(drag.start(pointer({pointerId:22})),false);
  begin.resolve(true);await ending;
  assert.deepEqual(calls.update,[[25,5]]);assert.deepEqual(calls.end,[false]);assert.deepEqual(calls.active,[true,false]);
});

test('cancel while begin is pending discards queued movement and ends once after admission',async()=>{
  const begin=deferred();const {drag,calls}=fixture({begin:()=>begin.promise});
  drag.start(pointer());drag.move(moved(130,220));const ending=drag.end(true);
  await drain();assert.deepEqual(calls.end,[]);begin.resolve(true);await ending;
  assert.deepEqual(calls.update,[]);assert.deepEqual(calls.end,[true]);assert.equal(drag.active,false);
});

test('cancellation waits for an issued update and discards later queued offsets',async()=>{
  const update=deferred();const {drag,calls}=fixture({update:()=>update.promise});
  drag.start(pointer());await drain();drag.move(moved(110,200));await drain();drag.move(moved(180,270));
  const cancelled=drag.end(true);await drain();assert.deepEqual(calls.end,[]);
  update.resolve();await cancelled;
  assert.deepEqual(calls.update,[[10,0]]);assert.deepEqual(calls.end,[true]);assert.equal(drag.active,false);
});

test('other pointer move or release cannot move or clear the captured session',async()=>{
  const {drag,calls}=fixture();drag.start(pointer());await drain();
  drag.move(moved(500,500,{pointerId:18}));await drag.end(false,18);
  assert.equal(drag.active,true);assert.equal(drag.pointerId,17);assert.deepEqual(calls.update,[]);assert.deepEqual(calls.end,[]);
  await drag.end(false,17);assert.equal(drag.active,false);
});

test('denied or failed begin releases local state without issuing moves or end',async()=>{
  for(const begin of [async()=>false,async()=>{throw new Error('begin failed');}]){
    const {drag,calls}=fixture({begin});drag.start(pointer());drag.move(moved(130,250));await drain();
    await drag.end();assert.equal(drag.active,false);assert.deepEqual(calls.active,[true,false]);assert.deepEqual(calls.update,[]);assert.deepEqual(calls.end,[]);
  }
});

test('native end failure still clears local state exactly once',async()=>{
  const {drag,calls}=fixture({end:async()=>{throw new Error('end failed');}});
  drag.start(pointer());await assert.rejects(drag.end(),/end failed/);
  assert.equal(drag.active,false);assert.deepEqual(calls.active,[true,false]);assert.deepEqual(calls.end,[false]);
  drag.nativeEnd();await drag.end(true);assert.deepEqual(calls.active,[true,false]);
});

test('failed touch update cancels native capture and clears local state without an unhandled rejection',async()=>{
  const {drag,calls}=fixture({update:async()=>{throw new Error('move failed');}});
  drag.start(pointer());await drain();drag.move(moved(115,215));await drain();
  assert.equal(drag.active,false);assert.deepEqual(calls.end,[true]);assert.deepEqual(calls.active,[true,false]);
});

test('a failed final flush still requests cancelled native cleanup',async()=>{
  const begin=deferred();const {drag,calls}=fixture({begin:()=>begin.promise,update:async()=>{throw new Error('final move failed');}});
  drag.start(pointer());drag.move(moved(150,250));const ending=drag.end();begin.resolve(true);await ending;
  assert.deepEqual(calls.end,[true]);assert.equal(drag.active,false);assert.deepEqual(calls.active,[true,false]);
});

test('native release and repeated capture-loss callbacks clear once and suppress later moves',async()=>{
  const {drag,calls}=fixture();drag.start(pointer({pointerType:'mouse'}));await drain();
  drag.nativeEnd();drag.nativeEnd();await drag.end(true);drag.move(moved(300,500));await drain();
  assert.equal(drag.active,false);assert.deepEqual(calls.active,[true,false]);assert.deepEqual(calls.end,[]);assert.deepEqual(calls.update,[]);
});

test('completion of an old end command cannot clear a new pointer session',async()=>{
  const oldEnd=deferred();let ends=0;const {drag,calls}=fixture({end:async()=>{if(++ends===1)await oldEnd.promise;}});
  drag.start(pointer({pointerType:'mouse'}));await drain();const ending=drag.end();await drain();
  drag.nativeEnd();assert.equal(drag.start(pointer({pointerId:22})),true);await drain();
  oldEnd.resolve();await ending;assert.equal(drag.active,true);assert.equal(drag.pointerId,22);
  await drag.end(false,22);assert.deepEqual(calls.active,[true,false,true,false]);
});

test('a late begin acknowledgment after native release cannot move or clear a replacement session',async()=>{
  const oldBegin=deferred();let begins=0;const {drag,calls}=fixture({begin:async()=>++begins===1?await oldBegin.promise:true});
  drag.start(pointer());drag.move(moved(160,260));await drain();drag.nativeEnd();
  drag.start(pointer({pointerId:22,pointerType:'pen'}));await drain();oldBegin.resolve(true);await drain();
  assert.equal(drag.pointerId,22);assert.equal(drag.active,true);assert.deepEqual(calls.update,[]);
  await drag.end(false,22);assert.deepEqual(calls.active,[true,false,true,false]);
});
