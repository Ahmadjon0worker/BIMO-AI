import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { installFakeDom } from "./fakedom.mjs";
import { BOT_STATES, BotEngine } from "../src/mochi/engine.ts";
import { QANOT_PALETTE, drawQanot, drawWardrobeIcon } from "../src/mochi/outfits.ts";
import { OUTFIT_SELECTIONS } from "../src/mochi/wardrobe.ts";
import { Greeting } from "../src/mochi/greeting.ts";
import { createMiniBot, miniBotCount, releaseMiniBot, tickMiniBots } from "../src/mochi/minibots.ts";
import { renderShareImage } from "../src/recap/share.ts";

// The existing upload sequence uses a TypeScript parameter property. Node's
// strip-only test runner cannot execute that syntax; transpile this one module
// in the test process without changing production code or the shared loader.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/src/upload/sequence.ts")) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { UploadCanvas } = await import("../src/upload/canvas.ts");
const { UploadSeq } = await import("../src/upload/sequence.ts");

// A canvas recorder applies the actual transform stack and rejects invalid
// geometry. This exercises every shipping character surface without WebView2.
function canvasRecorder() {
  const ops = [];
  let matrix = [1, 0, 0, 1, 0, 0], path = [];
  const stack = [];
  const state = { globalAlpha: 1, fillStyle: "", strokeStyle: "", font: "10px sans-serif" };
  const point = (x, y) => {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), "finite canvas coordinates");
    return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "save") return () => stack.push({ matrix: [...matrix], state: { ...state } });
      if (key === "restore") return () => {
        assert.ok(stack.length, "balanced restore");
        const saved = stack.pop(); matrix = saved.matrix; Object.assign(state, saved.state);
      };
      if (key === "translate") return (x, y) => { const p = point(x, y); matrix[4] = p[0]; matrix[5] = p[1]; };
      if (key === "scale") return (x, y) => {
        matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y;
      };
      if (key === "rotate") return angle => {
        const [a, b, c, d] = matrix, cs = Math.cos(angle), sn = Math.sin(angle);
        matrix[0] = a * cs + c * sn; matrix[1] = b * cs + d * sn;
        matrix[2] = c * cs - a * sn; matrix[3] = d * cs - b * sn;
      };
      if (key === "setTransform") return (...values) => { matrix = values; };
      if (key === "beginPath") return () => { path = []; };
      if (key === "moveTo" || key === "lineTo") return (x, y) => path.push(point(x, y));
      if (key === "fill" || key === "stroke") return () => ops.push({ kind: key, points: [...path], color: state[key === "fill" ? "fillStyle" : "strokeStyle"] });
      if (key === "fillText") return text => ops.push({ kind: "text", text });
      if (key === "measureText") return text => ({ width: String(text).length * 8 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop() {} });
      if (["arc", "arcTo", "ellipse", "bezierCurveTo", "quadraticCurveTo", "roundRect"].includes(key)) {
        return (...args) => ops.push({ kind: key, args });
      }
      return () => {};
    },
  });
  return { ctx, ops, balanced: () => assert.equal(stack.length, 0) };
}

function fakeCanvasDom() {
  installFakeDom();
  const create = document.createElement;
  const records = [];
  document.createElement = tag => {
    const el = create(tag);
    if (tag === "canvas") {
      const record = canvasRecorder(); records.push(record);
      el.getContext = () => record.ctx;
    }
    return el;
  };
  return records;
}

const curved = ops => ops.filter(op => ["arc", "arcTo", "ellipse", "bezierCurveTo", "quadraticCurveTo", "roundRect"].includes(op.kind));
const hasBrand = ops => ops.some(op => op.color === QANOT_PALETTE.gold) && ops.some(op => op.color === QANOT_PALETTE.light);

test("all Qanot expressions use angular wings and one central beacon", () => {
  for (const signal of ["pill", "wide", "dot", "line", "flat", "happy", "closed", "spiral", "heart", "star", "tired", "wink", "cup"]) {
    const r = canvasRecorder();
    drawQanot(r.ctx, 24, { signal, phase: 0.4 });
    assert.equal(curved(r.ops).length, 0, signal);
    assert.ok(hasBrand(r.ops), signal);
    r.balanced();
  }
  const normal = canvasRecorder();
  drawQanot(normal.ctx, 24);
  assert.equal(normal.ops.filter(op => op.kind === "fill" && op.color === QANOT_PALETTE.white).length, 1, "one compass beacon, no pair of eyes");
  const points = normal.ops.flatMap(op => op.points || []);
  assert.ok(points.every(([x, y]) => Math.abs(x) <= 24 * 1.12 && Math.abs(y) <= 24 * 0.9));
});

test("every agent state and mini variant uses the Qanot renderer", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const state of Object.keys(BOT_STATES)) {
    for (const mini of [false, true]) {
      const engine = new BotEngine(); engine.isMini = mini;
      engine.setState(state, true);
      const r = canvasRecorder(); engine.draw(r.ctx, 80, 80);
      assert.ok(hasBrand(r.ops), state);
      assert.equal(curved(r.ops).length, 0, state);
      r.balanced();
    }
  }
});

test("all saved styles and wardrobe icons render new geometric variants", () => {
  for (const selection of OUTFIT_SELECTIONS) {
    const r = canvasRecorder();
    drawWardrobeIcon(r.ctx, 32, selection, "witchHat", "AUTO");
    assert.ok(hasBrand(r.ops), selection);
    assert.equal(curved(r.ops).length, 0, selection);
    r.balanced();
  }
  const bare = canvasRecorder(), patterned = canvasRecorder();
  drawWardrobeIcon(bare.ctx, 32, "none", "none", "AUTO");
  drawWardrobeIcon(patterned.ctx, 32, "crown", "none", "AUTO");
  assert.ok(patterned.ops.length > bare.ops.length, "saved style changes engraving");
});

test("interrupted launch assembly completes once and leaves no pending callback", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0, completed = 0;
  t.mock.method(performance, "now", () => now);
  const greeting = new Greeting(); greeting.onComplete = () => completed++;
  greeting.start(); now = 1000; greeting.interrupt();
  const r = canvasRecorder();
  now = 1350; greeting.draw(r.ctx); greeting.draw(r.ctx);
  assert.equal(completed, 1); assert.equal(greeting.done, true);
  t.mock.timers.tick(4000); assert.equal(completed, 1);
  assert.ok(hasBrand(r.ops)); assert.equal(curved(r.ops).length, 0);
  r.balanced(); greeting.leave();
});

test("mini task canvases retain their lifecycle and new shared appearance", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const records = fakeCanvasDom();
  const slot = createMiniBot({ id: "test", color: "#22C6BD", state: "working" }, 20);
  assert.equal(miniBotCount(), 1);
  tickMiniBots(0.016);
  assert.ok(hasBrand(records[0].ops)); assert.equal(curved(records[0].ops).length, 0);
  releaseMiniBot(slot.children[0]); assert.equal(miniBotCount(), 0);
  records[0].balanced();
});

test("upload renders Qanot while its intake stays bound to sequence geometry", () => {
  const records = fakeCanvasDom();
  const upload = new UploadCanvas({ ask() {}, cancel() {} });
  const frame = { ...UploadSeq.frame(), morph: 1, mouthRect: { x: 235, y: 70, w: 42, h: 8 }, fileVisible: false };
  upload.draw(frame, 0);
  const r = records[0];
  assert.ok(hasBrand(r.ops));
  const slot = r.ops.find(op => op.kind === "stroke" && op.color === QANOT_PALETTE.gold && op.points.some(([x, y]) => x === 233 && y === 70));
  assert.ok(slot, "intake paints the actual suction/hit target");
  r.balanced();
});

test("shared recap image uses Qanot visual and fork branding", () => {
  const records = fakeCanvasDom();
  const date = new Date(2026, 9, 5);
  const canvas = renderShareImage({ weekStart: date, weekEnd: date, totalMinutes: 0, sessionCount: 0,
    filesChanged: 0, linesAdded: 0, linesRemoved: 0, commandsRun: 0, questions: 0,
    permissionsAllowed: 0, permissionsDenied: 0, topAgent: null, topProject: null,
    busiestDay: null, longestSessionMinutes: 0 }, false);
  assert.equal(canvas.width, 1080); assert.equal(canvas.height, 1920);
  const r = records[0], texts = r.ops.filter(op => op.kind === "text").map(op => op.text);
  assert.ok(texts.includes("Qanot AI"));
  assert.ok(texts.some(text => text === "Qanot AI · github.com/Ahmadjon0worker/CouCou-Uzbek-edition-"));
  assert.ok(hasBrand(r.ops)); r.balanced();
});
