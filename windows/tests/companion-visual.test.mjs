import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { installFakeDom } from "./fakedom.mjs";
import { BOT_STATES, BotEngine } from "../src/mochi/engine.ts";
import { drawWardrobeIcon } from "../src/mochi/outfits.ts";
import { OUTFIT_SELECTIONS } from "../src/mochi/wardrobe.ts";
import { Greeting } from "../src/mochi/greeting.ts";
import { drawMoshi, moshiBodyPath, moshiVariantFor, MOSHI_PALETTE } from "../src/mochi/moshi.ts";
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

const finite = args => args.filter(arg => typeof arg === "number").forEach(arg =>
  assert.ok(Number.isFinite(arg), "finite canvas geometry"));
const endpoint = op => {
  if (["moveTo", "lineTo"].includes(op.kind)) return op.args.slice(0, 2);
  if (op.kind === "quadraticCurveTo") return op.args.slice(2, 4);
  if (op.kind === "bezierCurveTo") return op.args.slice(4, 6);
  return null;
};

// Keep Path2D commands separate from the current canvas path, as a browser does.
// The Moshi renderer clips and paints the same body path several times.
class RecordedPath {
  commands = [];
  constructor(path) { if (path) this.commands = [...path.commands]; }
  addPath(path) { this.commands.push(...path.commands); }
}
for (const key of ["moveTo", "lineTo", "arc", "arcTo", "ellipse", "bezierCurveTo", "quadraticCurveTo", "rect", "roundRect", "closePath"]) {
  RecordedPath.prototype[key] = function (...args) {
    finite(args); this.commands.push({ kind: key, args });
  };
}
globalThis.Path2D = RecordedPath;

// Apply transforms and reject invalid geometry on every shipping surface.
// This checks canvas contracts and lifecycle without replacing the drawing code.
function canvasRecorder() {
  const ops = [];
  let matrix = [1, 0, 0, 1, 0, 0], path = [];
  const stack = [];
  const state = { globalAlpha: 1, fillStyle: "", strokeStyle: "", font: "10px sans-serif", canvas: { width: 80, height: 80 } };
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
        finite([x, y]);
        matrix[0] *= x; matrix[1] *= x; matrix[2] *= y; matrix[3] *= y;
      };
      if (key === "rotate") return angle => {
        finite([angle]);
        const [a, b, c, d] = matrix, cs = Math.cos(angle), sn = Math.sin(angle);
        matrix[0] = a * cs + c * sn; matrix[1] = b * cs + d * sn;
        matrix[2] = c * cs - a * sn; matrix[3] = d * cs - b * sn;
      };
      if (key === "getTransform") return () => {
        const [a, b, c, d, e, f] = matrix; return { a, b, c, d, e, f };
      };
      if (key === "setTransform") return (...values) => {
        const m = values[0];
        matrix = values.length === 1 ? [m.a, m.b, m.c, m.d, m.e, m.f] : values;
        finite(matrix);
      };
      if (key === "beginPath") return () => { path = []; };
      if (key === "moveTo" || key === "lineTo") return (x, y) => path.push({ kind: key, args: [x, y], point: point(x, y) });
      if (key === "fill" || key === "stroke") return savedPath => {
        const commands = savedPath instanceof RecordedPath ? savedPath.commands : path;
        const points = commands.filter(op => endpoint(op))
          .map(op => op.point || point(...endpoint(op)));
        ops.push({ kind: key, points, commands: [...commands], transform: [...matrix],
          alpha: state.globalAlpha, color: state[key === "fill" ? "fillStyle" : "strokeStyle"] });
      };
      if (key === "fillText") return text => ops.push({ kind: "text", text });
      if (key === "measureText") return text => ({ width: String(text).length * 8 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return (...args) => {
        finite(args);
        const gradient = { kind: key, stops: [], addColorStop(offset, color) {
          assert.ok(Number.isFinite(offset) && offset >= 0 && offset <= 1);
          this.stops.push([offset, color]);
        } };
        return gradient;
      };
      if (["arc", "arcTo", "ellipse", "bezierCurveTo", "quadraticCurveTo", "rect", "roundRect"].includes(key)) {
        return (...args) => {
          finite(args);
          const op = { kind: key, args }, anchor = endpoint(op);
          path.push(anchor ? { ...op, point: point(...anchor) } : op);
          ops.push(op);
        };
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
      el.width = 80; el.height = 80;
      record.ctx.canvas = el;
      el.getContext = () => record.ctx;
    }
    return el;
  };
  return records;
}

const paints = ops => ops.filter(op => op.kind === "fill" || op.kind === "stroke");
const bodyTopology = moshiBodyPath(1, 1).commands.map(op => op.kind).join(",");
const hasMoshiBody = (ops, minWidth = 8) => paints(ops).some(op =>
  op.commands.map(command => command.kind).join(",") === bodyTopology &&
  Math.max(...op.points.map(point => point[0])) - Math.min(...op.points.map(point => point[0])) >= minWidth);
const paintSignature = ops => JSON.stringify(paints(ops).map(op => ({ color: op.color,
  commands: op.commands, transform: op.transform, alpha: op.alpha })));

test("Moshi has a closed silhouette with five softly rounded corners", () => {
  const path = moshiBodyPath(24, 18);
  assert.equal(path.commands[0].kind, "moveTo");
  assert.equal(path.commands.at(-1).kind, "closePath");
  const sides = path.commands.filter(op => op.kind === "bezierCurveTo");
  const corners = path.commands.filter(op => op.kind === "quadraticCurveTo");
  assert.equal(sides.length, 5, "five gently bowed sides");
  assert.equal(corners.length, 5, "five soft corners");
  assert.ok(path.commands.length <= 16, "the body follows its five polygon edges");
});

test("custom panel colours retain the original soft shading and reflected highlight", () => {
  for (const color of [null, [0.15, 0.65, 0.50]]) {
    const engine = new BotEngine(); engine.variant = color ? "codex" : "moshi"; engine.bodyColor = color;
    const r = canvasRecorder(); engine.draw(r.ctx, 80, 80);
    const bodyFills = paints(r.ops).filter(op => op.kind === "fill" &&
      op.commands.map(command => command.kind).join(",") === bodyTopology);
    const gradient = bodyFills.find(op => op.color?.kind === "createLinearGradient");
    assert.ok(gradient, "body has a directional material gradient");
    assert.notEqual(gradient.color.stops[0][1], gradient.color.stops.at(-1)[1], "top and bottom retain different lighting");
    const radial = bodyFills.filter(op => op.color?.kind === "createRadialGradient");
    assert.ok(radial.length >= 2, "body retains diffuse edge shading and a reflected highlight");
    assert.ok(radial.some(op => op.color.stops.some(([, stop]) => /rgba\(255,255,255,/.test(stop))), "a white specular reflection remains visible");
    r.balanced();
  }
});

test("the mailbox morph retains all five rounded corners throughout the transition", () => {
  for (const morph of [0, 0.25, 0.5, 0.75, 1]) {
    const path = moshiBodyPath(24, 18, morph);
    assert.equal(path.commands.filter(op => op.kind === "quadraticCurveTo").length, 5);
    assert.equal(path.commands.at(-1).kind, "closePath");
    path.commands.forEach(op => op.args.forEach(value => {
      if (typeof value === "number") assert.ok(Number.isFinite(value));
    }));
  }
});

test("the idle Moshi companion has a five-sided body and two separate eyes", () => {
  const engine = new BotEngine();
  const r = canvasRecorder(); engine.draw(r.ctx, 80, 80);
  assert.ok(hasMoshiBody(r.ops, 40));
  const eyes = r.ops.filter(op => op.kind === "fill" && op.color === MOSHI_PALETTE.moshi.ink);
  assert.equal(eyes.length, 2, "both eyes are painted");
  const centers = eyes.map(op => op.transform[4]);
  assert.ok(centers[0] < 40 && centers[1] > 40, "eyes sit on either side of the face");
  r.balanced();
});

test("Codex, OpenCode and Telegram have distinct Moshi companion artwork", () => {
  const render = variant => {
    const r = canvasRecorder(); drawMoshi(r.ctx, 24, { variant, phase: 0 });
    assert.ok(hasMoshiBody(r.ops, 40), `${variant}: five-sided Moshi body`);
    r.balanced();
    // Ignore the palette: different service designs must add their own artwork,
    // rather than satisfying this requirement with a colour change alone.
    return JSON.stringify(paints(r.ops).map(op => ({ commands: op.commands, transform: op.transform })));
  };
  const signatures = ["moshi", "codex", "opencode", "telegram"].map(render);
  assert.equal(new Set(signatures).size, 4, "each service has a distinct silhouette or accessory");
  assert.equal(moshiVariantFor("codex"), "codex");
  assert.equal(moshiVariantFor("opencode"), "opencode");
  assert.equal(moshiVariantFor("telegram"), "telegram");
});

test("all current agent states render on main and mini canvases without invalid geometry", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const state of Object.keys(BOT_STATES)) {
    for (const mini of [false, true]) {
      const engine = new BotEngine(); engine.isMini = mini;
      engine.setState(state, true);
      const r = canvasRecorder(); engine.draw(r.ctx, 80, 80);
      assert.ok(paints(r.ops).length > 0, `${state}: a visible companion`);
      assert.ok(hasMoshiBody(r.ops, 40), `${state}: five-sided body`);
      r.balanced();
    }
  }
});

test("working, blinking and emotes change Moshi's rendered pose", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.method(Math, "random", () => 0.5);
  const engine = new BotEngine(); engine.setState("working", true);
  const first = canvasRecorder(); engine.draw(first.ctx, 80, 80);
  for (let frame = 1; frame <= 30; frame++) { now = frame * 1000 / 60; engine.update(1 / 60); }
  const moved = canvasRecorder(); engine.draw(moved.ctx, 80, 80);
  assert.notEqual(paintSignature(first.ops), paintSignature(moved.ops), "working bobs and breathes");
  engine.blink(); now += 70; engine.update(1 / 60);
  assert.ok(engine.open < 0.1, "blink closes the eyes");
  const closed = canvasRecorder(); engine.draw(closed.ctx, 80, 80);
  assert.notEqual(paintSignature(moved.ops), paintSignature(closed.ops), "blink is drawn");
  const emoteSignatures = [];
  for (const emote of ["love", "surprised", "proud", "wink", "yawn", "happy", "annoyed"]) {
    const companion = new BotEngine(); companion.triggerEmote(emote);
    const r = canvasRecorder(); companion.draw(r.ctx, 80, 80);
    assert.ok(hasMoshiBody(r.ops, 40), `${emote}: Moshi remains five-sided`);
    emoteSignatures.push(paintSignature(r.ops)); r.balanced();
  }
  assert.ok(new Set(emoteSignatures).size >= 5, "emotes show distinct facial expressions or particles");
  first.balanced(); moved.balanced(); closed.balanced();
});

test("all saved outfits render wardrobe icons and actual companion artwork", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const selection of OUTFIT_SELECTIONS) {
    const r = canvasRecorder();
    drawWardrobeIcon(r.ctx, 32, selection, "witchHat", "AUTO");
    assert.ok(paints(r.ops).length > 0, selection);
    r.balanced();
    if (selection === "auto") continue;
    const engine = new BotEngine(); engine.setOutfit(selection, false);
    const companion = canvasRecorder(); engine.draw(companion.ctx, 80, 80);
    assert.ok(paints(companion.ops).length > 0, `${selection}: companion`);
    companion.balanced();
  }
  const bare = canvasRecorder(), patterned = canvasRecorder();
  drawWardrobeIcon(bare.ctx, 32, "none", "none", "AUTO");
  drawWardrobeIcon(patterned.ctx, 32, "crown", "none", "AUTO");
  assert.ok(patterned.ops.length > bare.ops.length, "crown icon includes clothing artwork");
});

test("the Moshi greeting still completes interrupted launches once", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0, completed = 0;
  t.mock.method(performance, "now", () => now);
  const greeting = new Greeting(); greeting.onComplete = () => completed++;
  greeting.start(); now = 1000; greeting.interrupt();
  const r = canvasRecorder();
  now = 1350; greeting.draw(r.ctx); greeting.draw(r.ctx);
  assert.equal(completed, 1); assert.equal(greeting.done, true);
  t.mock.timers.tick(4000); assert.equal(completed, 1);
  assert.ok(paints(r.ops).length > 0);
  assert.ok(hasMoshiBody(r.ops));
  r.balanced(); greeting.leave();
});

test("the Moshi greeting stays active for its wave and completes naturally once", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0, completed = 0;
  t.mock.method(performance, "now", () => now);
  const greeting = new Greeting(); greeting.onComplete = () => completed++;
  greeting.start();
  const duringWave = canvasRecorder(); now = 1800; greeting.draw(duringWave.ctx);
  assert.equal(completed, 0); assert.equal(greeting.done, false);
  assert.ok(hasMoshiBody(duringWave.ops));
  const afterWave = canvasRecorder(); now = 2300; greeting.draw(afterWave.ctx);
  assert.notEqual(paintSignature(duringWave.ops), paintSignature(afterWave.ops), "the waving greeting animates");
  now = 4600; greeting.draw(afterWave.ctx); greeting.draw(afterWave.ctx);
  t.mock.timers.tick(5000);
  assert.equal(completed, 1); assert.equal(greeting.done, true);
  duringWave.balanced(); afterWave.balanced(); greeting.leave();
});

test("mini task canvases retain their lifecycle and task color", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const records = fakeCanvasDom();
  const slot = createMiniBot({ id: "test", color: "#22C6BD", state: "working" }, 20);
  assert.equal(miniBotCount(), 1);
  tickMiniBots(0.016);
  const colors = paints(records[0].ops).flatMap(op => typeof op.color === "string" ? [op.color] :
    (op.color?.stops ?? []).map(([, color]) => color));
  assert.ok(colors.some(color => color === "rgba(34,198,189,1)" || color === "rgb(34,198,189)" || color === "#22C6BD"));
  assert.ok(hasMoshiBody(records[0].ops, 15));
  releaseMiniBot(slot.children[0]); assert.equal(miniBotCount(), 0);
  records[0].balanced();
});

test("upload keeps Moshi's five sides, mailbox slot and working choose controls", () => {
  const records = fakeCanvasDom();
  let asked = 0, cancelled = 0;
  const upload = new UploadCanvas({ ask() { asked++; }, cancel() { cancelled++; } });
  const frame = { ...UploadSeq.frame(), morph: 1, mouth: 0.42, fileVisible: false, chooseAlpha: 1 };
  upload.draw(frame, 0);
  const r = records[0];
  assert.ok(hasMoshiBody(r.ops));
  assert.equal(r.ops.filter(op => op.kind === "fill" && op.color === MOSHI_PALETTE.moshi.ink).length, 2, "both upload eyes");
  assert.ok(paints(r.ops).some(op => op.color?.stops?.some(([, color]) => color === "#030304")), "open mailbox slot");
  const overlay = upload.el.children[1];
  assert.equal(overlay.style.display, "block");
  overlay.children[0].fire("click"); overlay.children[1].fire("click");
  assert.equal(asked, 1); assert.equal(cancelled, 1);
  upload.draw({ ...frame, chooseAlpha: 0 }, 0);
  assert.equal(overlay.style.display, "none");
  r.balanced();
});

test("the animated five-sided mailbox preserves the sequence's suction target", t => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const records = fakeCanvasDom();
  const upload = new UploadCanvas({ ask() {}, cancel() {} });
  try {
    UploadSeq.enterZone(140, 90); now = 1000; UploadSeq.frame();
    UploadSeq.performDrop(2.4); now += 220;
    const frame = { ...UploadSeq.frame(), tilt: 0 };
    assert.ok(frame.suck > 0 && frame.suck < 1, "real suction phase");
    assert.ok(frame.mouthRect.w > 0 && frame.mouthRect.h > 0, "sequence exposes an open mouth");
    upload.draw(frame, now / 1000);
    const r = records[0];
    assert.ok(hasMoshiBody(r.ops));
    const slot = paints(r.ops).find(op => op.color?.stops?.some(([, color]) => color === "#030304"));
    assert.ok(slot, "open mailbox slot is rendered");
    const rectangle = slot.commands.find(op => op.kind === "roundRect");
    assert.ok(rectangle);
    const [x, y, w, h] = rectangle.args, [a, b, c, d, e, f] = slot.transform;
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} matches ${expected}`);
    near(a * x + c * y + e, frame.mouthRect.x);
    near(b * x + d * y + f, frame.mouthRect.y);
    near(a * w, frame.mouthRect.w); near(d * h, frame.mouthRect.h);
    const clipY = frame.mouthRect.y + frame.mouthRect.h / 2;
    assert.ok(r.ops.some(op => op.kind === "rect" && op.args[0] === 0 && op.args[1] === 0 &&
      Math.abs(op.args[3] - clipY) < 1e-6), "file strips disappear at the original mouth line");
    r.balanced();
  } finally { UploadSeq.deactivate(); }
});

test("shared recap image renders Moshi while preserving BIMO AI branding", () => {
  const records = fakeCanvasDom();
  const date = new Date(2026, 9, 5);
  const canvas = renderShareImage({ weekStart: date, weekEnd: date, totalMinutes: 0, sessionCount: 0,
    filesChanged: 0, linesAdded: 0, linesRemoved: 0, commandsRun: 0, questions: 0,
    permissionsAllowed: 0, permissionsDenied: 0, topAgent: null, topProject: null,
    busiestDay: null, longestSessionMinutes: 0 }, false);
  assert.equal(canvas.width, 1080); assert.equal(canvas.height, 1920);
  const r = records[0], texts = r.ops.filter(op => op.kind === "text").map(op => op.text);
  assert.ok(texts.includes("BIMO AI"));
  assert.ok(texts.some(text => text === "BIMO AI · github.com/Ahmadjon0worker/BIMO-AI"));
  assert.ok(hasMoshiBody(r.ops, 140)); r.balanced();
});
