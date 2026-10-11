// Painted-panel geometry regressions; no native monitor or pointer actions.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PANEL_DOCKS, panelDock, compactShape, compactSize, panelRect,
  panelRadii, compactParts} from '../src/island/panel-layout.ts';

const sizes = {
  free: [288, 32], top: [288, 32], bottom: [288, 32],
  left: [40, 192], right: [40, 192],
  'top-left': [80, 80], 'top-right': [80, 80],
  'bottom-left': [80, 80], 'bottom-right': [80, 80],
};
const attached = {
  free: [], top: ['top'], bottom: ['bottom'], left: ['left'], right: ['right'],
  'top-left': ['top', 'left'], 'top-right': ['top', 'right'],
  'bottom-left': ['bottom', 'left'], 'bottom-right': ['bottom', 'right'],
};
function assertRect(rect, dock, hostW, hostH) {
  assert.ok(rect.x >= 0 && rect.y >= 0, `${dock}: negative painted origin`);
  assert.ok(rect.x + rect.w <= hostW, `${dock}: right edge outside host`);
  assert.ok(rect.y + rect.h <= hostH, `${dock}: bottom edge outside host`);
  for (const edge of attached[dock]) {
    const distance = {left: rect.x, top: rect.y,
      right: hostW - rect.x - rect.w, bottom: hostH - rect.y - rect.h}[edge];
    assert.equal(distance, 0, `${dock}: transparent margin at attached ${edge} edge`);
  }
  if (['free', 'top', 'bottom'].includes(dock)) {
    assert.equal(rect.x + rect.w / 2, hostW / 2, `${dock}: horizontal center`);
  }
  if (['left', 'right'].includes(dock)) {
    assert.equal(rect.y + rect.h / 2, hostH / 2, `${dock}: vertical center`);
  }
  if (dock === 'free') assert.equal(rect.y, 0);
}
const box = (x, y, w, h) => ({x, y, w, h});
function inside(part, w, h, label) {
  assert.ok(part.x >= 0 && part.y >= 0 && part.x + part.w <= w && part.y + part.h <= h,
    `${label} must fit inside ${w}x${h}`);
}
function separate(a, b, label) {
  assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x ||
    a.y + a.h <= b.y || b.y + b.h <= a.y, `${label} hit targets overlap`);
}

test('saved dock contract has all nine distinct placements', () => {
  assert.deepEqual([...PANEL_DOCKS].sort(), Object.keys(sizes).sort());
});

test('missing saved positions reset to top and explicit free survives a boundary position', () => {
  assert.equal(panelDock(), 'top');
  assert.equal(panelDock(null), 'top');
  for (const position of [{x: 0, y: 0}, {x: 1, y: 1}, {x: .5, y: 0}]) {
    assert.equal(panelDock({...position, dock: 'free'}), 'free');
  }
});

test('legacy normalized edges migrate to their visible edge or corner without snapping interiors', () => {
  for (const [x, y, expected] of [
    [.3, .4, 'free'], [.00001, .99999, 'free'],
    [.5, 0, 'top'], [.5, 1, 'bottom'], [0, .5, 'left'], [1, .5, 'right'],
    [0, 0, 'top-left'], [1, 0, 'top-right'], [0, 1, 'bottom-left'], [1, 1, 'bottom-right'],
  ]) assert.equal(panelDock({x, y}), expected, `${x},${y}`);
  assert.equal(panelDock({x: 1, y: .5, dock: 'obsolete'}), 'right');
});

test('an explicit supported dock takes precedence over its legacy normalized coordinates', () => {
  for (const dock of PANEL_DOCKS) assert.equal(panelDock({x: .37, y: .46, dock}), dock);
});

test('compact profiles use horizontal bars, vertical side bars, and square corner panels', () => {
  for (const [dock, [w, h]] of Object.entries(sizes)) {
    assert.deepEqual(compactSize(dock), {w, h}, dock);
    assert.equal(compactShape(dock), w === 40 ? 'vertical' : w === 80 ? 'square' : 'horizontal', dock);
  }
});

test('every compact painted panel touches its attached screen edges with zero host margin', () => {
  for (const [hostW, hostH] of [[720, 320], [960, 480]]) {
    for (const [dock, [w, h]] of Object.entries(sizes)) {
      const rect = panelRect(w, h, dock, hostW, hostH);
      assert.deepEqual({w: rect.w, h: rect.h}, {w, h});
      assertRect(rect, dock, hostW, hostH);
    }
  }
});

test('expanded views and interpolated spring sizes remain flush while changing height', () => {
  for (const [hostW, hostH] of [[720, 320], [960, 480]]) {
    for (const dock of PANEL_DOCKS) {
      for (const h of [150, 160, 176, 184, 200, 240, 280, 300]) {
        assertRect(panelRect(640, h, dock, hostW, hostH), dock, hostW, hostH);
      }
      for (const [w, h] of [[456, 112], [359.5, 76.25], [700, 319]]) {
        assertRect(panelRect(w, h, dock, hostW, hostH), dock, hostW, hostH);
      }
    }
  }
});

test('the default host and a fully filled host align without negative positions', () => {
  assert.deepEqual(panelRect(288, 32, 'bottom'), {x: 216, y: 288, w: 288, h: 32});
  assert.deepEqual(panelRect(40, 192, 'right'), {x: 680, y: 64, w: 40, h: 192});
  for (const dock of PANEL_DOCKS) assert.deepEqual(panelRect(720, 320, dock), {x: 0, y: 0, w: 720, h: 320});
});

test('hidden zero-height geometry remains finite and edge aligned', () => {
  for (const dock of PANEL_DOCKS) assertRect(panelRect(184, 0, dock), dock, 720, 320);
});

test('attached corners are square and only unattached corners retain their radius', () => {
  const expected = {
    free: '12px 12px 12px 12px', top: '0px 0px 12px 12px', bottom: '12px 12px 0px 0px',
    left: '0px 12px 12px 0px', right: '12px 0px 0px 12px',
    'top-left': '0px 0px 12px 0px', 'top-right': '0px 0px 0px 12px',
    'bottom-left': '0px 12px 0px 0px', 'bottom-right': '12px 0px 0px 0px',
  };
  for (const dock of PANEL_DOCKS) {
    assert.equal(panelRadii(dock, 12), expected[dock], dock);
    assert.equal(panelRadii(dock, 0), '0px 0px 0px 0px');
  }
});

test('compact bot body, all task indicators, and the drag handle remain inside every profile', () => {
  for (const [dock, [w, h]] of Object.entries(sizes)) {
    const {bot, grid, handle} = compactParts(dock, w, h);
    inside(box(bot.cx - 10, bot.cy - 10, 20, 20), w, h, `${dock} bot`);
    inside(box(grid.x, grid.y, grid.width, grid.height), w, h, `${dock} four-task grid`);
    inside(box(handle.x, handle.y, 24, 24), w, h, `${dock} drag handle`);
    assert.equal(grid.columns, compactShape(dock) === 'vertical' ? 1 : 2);
    const rows = Math.ceil(4 / grid.columns);
    assert.ok(grid.width >= grid.columns * 13 + (grid.columns - 1) * 3);
    assert.ok(grid.height >= rows * 13 + (rows - 1) * 3);
  }
});

test('compact drag controls do not cover the bot or any task indicator', () => {
  for (const [dock, [w, h]] of Object.entries(sizes)) {
    const {bot, grid, handle} = compactParts(dock, w, h);
    const botBox = box(bot.cx - 10, bot.cy - 10, 20, 20);
    const gridBox = box(grid.x, grid.y, grid.width, grid.height);
    const handleBox = box(handle.x, handle.y, 24, 24);
    separate(botBox, handleBox, `${dock} bot/handle`);
    separate(gridBox, handleBox, `${dock} task/handle`);
    separate(botBox, gridBox, `${dock} bot/task`);
  }
});
