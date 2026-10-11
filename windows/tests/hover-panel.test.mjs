import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { IslandStateMachine } from '../src/island/fsm.ts';
import { State, DEFAULT_SETTINGS } from '../src/core/state.ts';
import { PANEL_DOCKS, compactSize, panelRect } from '../src/island/panel-layout.ts';

// Import the real island handler; the upload spring's parameter property needs
// Node's transform mode instead of the suite's usual strip-only loader.
registerHooks({ load(url, context, next) {
  if (url.endsWith('/src/upload/sequence.ts')) return {
    format: 'module', shortCircuit: true,
    source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }),
  };
  return next(url, context);
} });
const { Island } = await import('../src/island/island.ts');

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  State.tasks = []; State.isPinned = false; State.pendingApproval = null; State.stateOverride = null;
  State.settings = { ...DEFAULT_SETTINGS, openOnHover: true };
});
afterEach(() => mock.timers.reset());
function panel(dock) {
  State.settings.islandPosition = { monitor: 'fixture', x: .5, y: .5, dock };
  const host = Object.create(Island.prototype);
  host.fsm = new IslandStateMachine(); host.panelDrag = { active: false };
  host.desktop = { launch() {} }; host.wasInIsland = false; host.botHovering = false;
  host.width = { value: 0 }; host.height = { value: 0 };
  host.ensureRunning = () => {}; host.isBotHit = () => false;
  const resize = (mode) => {
    State.mode = mode;
    const size = mode === 'expanded' ? { w: 640, h: 176 } : compactSize(dock);
    host.width.value = size.w; host.height.value = size.h;
  };
  host.setMode = resize; host.expand = () => resize('expanded');
  host.wireFsm(); host.fsm.forcePetit();
  return host;
}
const center = (host) => { const r = host.islandRect(); return [r.x + r.w / 2, r.y + r.h / 2]; };
test('hover opens each custom dock without arming a false leave timer, then folds in place', () => {
  for (const dock of PANEL_DOCKS) {
    const host = panel(dock);
    const before = host.islandRect();
    host.onCursor(...center(host));
    assert.equal(host.fsm.state, 'home', dock);
    assert.equal(host.wasInIsland, true, dock);
    assert.equal(host.fsm.homeCollapseDueAt, null, `${dock}: entry must not count as leave`);
    mock.timers.tick(6000); assert.equal(host.fsm.state, 'home', dock);
    host.onCursor(-10000, -10000); mock.timers.tick(600);
    assert.equal(host.fsm.state, 'petit', dock);
    assert.deepEqual(host.islandRect(), before, `${dock}: compact geometry preserved`);
    assert.deepEqual(before, panelRect(compactSize(dock).w, compactSize(dock).h, dock));
    host.fsm.cancelTimers();
  }
});
test('manual collapse still reopens from every dock and resets hover ownership', () => {
  for (const dock of PANEL_DOCKS) {
    const host = panel(dock);
    host.onCursor(...center(host)); host.collapse();
    assert.equal(host.fsm.state, 'petit', dock);
    assert.equal(host.fsm.openedByHover, false, dock);
    host.onCursor(...center(host)); assert.equal(host.fsm.state, 'petit', `${dock}: manual fold stays folded`);
    host.onCursor(-10000, -10000); host.onCursor(...center(host));
    assert.equal(host.fsm.state, 'home', `${dock}: next intentional hover reopens`);
    host.fsm.cancelTimers();
  }
});
test('active panel drag suppresses hover transitions and desktop shortcut', () => {
  const host = panel('bottom-right'); let flights = 0;
  host.desktop.flyOutOrHome = () => flights++;
  host.panelDrag.active = true;
  host.onCursor(...center(host)); host.flyOutOrHome();
  assert.equal(host.fsm.state, 'petit'); assert.equal(flights, 0);
  host.panelDrag.active = false; host.onCursor(...center(host));
  assert.equal(host.fsm.state, 'home'); host.flyOutOrHome(); assert.equal(flights, 1);
});
