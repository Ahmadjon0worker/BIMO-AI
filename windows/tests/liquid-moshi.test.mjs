import { test } from "node:test";
import assert from "node:assert/strict";
import { drawMoshiShell, moshiLiquidLight, moshiFresnel, MOSHI_PALETTE } from "../src/mochi/moshi.ts";
import { BotEngine } from "../src/mochi/engine.ts";

class TestPath {
  commands = [];
}
for (const method of ["moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "ellipse", "closePath"]) {
  TestPath.prototype[method] = function (...args) { this.commands.push([method, ...args]); };
}
globalThis.Path2D = TestPath;

function recordCanvas() {
  const draws = [], gradients = [], stack = [];
  const state = { globalAlpha: 1, fillStyle: null, strokeStyle: null };
  const finite = values => values.filter(v => typeof v === "number").forEach(v => assert.ok(Number.isFinite(v)));
  const context = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "save") return () => stack.push({ ...state });
      if (key === "restore") return () => {
        assert.ok(stack.length, "canvas restore must match a save");
        Object.assign(state, stack.pop());
      };
      if (key === "createLinearGradient" || key === "createRadialGradient") return (...geometry) => {
        finite(geometry);
        const gradient = { kind: key, geometry, stops: [], addColorStop(offset, color) {
          assert.ok(offset >= 0 && offset <= 1);
          this.stops.push([offset, color]);
        } };
        gradients.push(gradient); return gradient;
      };
      if (key === "fill" || key === "stroke") return path => draws.push({ kind: key,
        path: path?.commands, alpha: state.globalAlpha, color: state[key === "fill" ? "fillStyle" : "strokeStyle"] });
      return (...args) => finite(args);
    },
  });
  return { context, draws, gradients, check: () => assert.equal(stack.length, 0),
    signature: () => JSON.stringify({ draws, gradients }) };
}

const colorAlpha = color => {
  if (!color.startsWith("rgba(")) return 1;
  return Number(color.slice(color.lastIndexOf(",") + 1, -1));
};

test("liquid material leaves the backdrop visible for every service and mailbox pose", () => {
  for (const variant of Object.keys(MOSHI_PALETTE)) {
    for (const mailbox of [0, .5, 1]) {
      const r = recordCanvas();
      drawMoshiShell(r.context, 28, { variant, mailbox, bodyColor: "#2dd4bf", phase: 3.4 });
      const fills = r.draws.filter(draw => draw.kind === "fill");
      assert.ok(fills.length >= 4, "real lens depth is painted");
      for (const draw of fills) {
        const colors = typeof draw.color === "string" ? [draw.color] : draw.color.stops.map(([, color]) => color);
        assert.ok(Math.max(...colors.map(colorAlpha)) * draw.alpha < 1,
          `${variant}: a body layer cannot replace the backdrop with opaque paint`);
      }
      assert.ok(r.draws.some(draw => draw.kind === "stroke" && draw.path), "shaped bezel uses the real body path");
      r.check();
    }
  }
});

test("Fresnel lighting reflects grazing edges while transmitting the front face", () => {
  assert.ok(Math.abs(moshiFresnel(1) - .04) < 1e-12);
  assert.equal(moshiFresnel(0), 1);
  assert.equal(moshiFresnel(-2), 1);
  assert.equal(moshiFresnel(2), moshiFresnel(1));
  const values = [0, .2, .4, .6, .8, 1].map(cos => moshiFresnel(cos));
  values.slice(1).forEach((value, i) => assert.ok(value < values[i], "reflectivity falls towards the centre"));
});

test("liquid reflections respond to gaze and freeze their drift with reduced motion", () => {
  assert.notDeepEqual(moshiLiquidLight({ phase: 0 }), moshiLiquidLight({ phase: 5 }));
  assert.notDeepEqual(moshiLiquidLight({ yaw: -.7 }), moshiLiquidLight({ yaw: .7 }));
  const a = recordCanvas(), b = recordCanvas();
  drawMoshiShell(a.context, 28, { phase: 0, reducedMotion: true });
  drawMoshiShell(b.context, 28, { phase: 12, reducedMotion: true });
  assert.equal(a.signature(), b.signature(), "static mode keeps the same complete material paint");
  a.check(); b.check();
});

test("the shipping engine uses transparent material while retaining Mochi's black face", t => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const engine = new BotEngine(); engine.reducedMotion = true;
  const a = recordCanvas(); engine.draw(a.context, 80, 80);
  now = 15000;
  const b = recordCanvas(); engine.draw(b.context, 80, 80);
  assert.equal(a.signature(), b.signature(), "a paused engine cannot keep drifting its glass highlights");
  assert.equal(a.draws.filter(draw => draw.kind === "fill" && draw.color === MOSHI_PALETTE.moshi.ink).length, 2);
  const film = a.draws.find(draw => draw.kind === "fill" && draw.color?.kind === "createLinearGradient");
  assert.ok(film.alpha > 0 && film.alpha < .5, "the actual engine paints a transmissive body");
  a.check(); b.check();
});
