import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesRelease } from "../scripts/bundle-selection.mjs";

const current = { productName: "Coucou", version: "0.3.0", platform: "win32", architecture: "x64", suffix: "-setup.exe" };
test("pack accepts the new product name including its space and rejects inherited packages", () => {
  const qanot = { ...current, productName: "Qanot AI", version: "0.6.3" };
  assert.equal(matchesRelease("Qanot AI_0.6.3_x64-setup.exe", qanot), true);
  assert.equal(matchesRelease("Qanot AI_0.6.3_x64_en-US.msi", { ...qanot, suffix: ".msi" }), true);
  for (const file of ["Coucou_0.6.3_x64-setup.exe", "Qanot AI_0.6.2_x64-setup.exe", "Qanot AI_0.6.3_arm64-setup.exe"]) {
    assert.equal(matchesRelease(file, qanot), false, file);
  }
});
test("pack rejects stale releases and wrong Windows architecture", () => {
  assert.equal(matchesRelease("Coucou_0.3.0_x64-setup.exe", current), true);
  for (const file of ["Coucou_0.2.0_x64-setup.exe", "Coucou_0.3.0_arm64-setup.exe",
    "Coucou_0.3.0_x64evil-setup.exe", "Other_0.3.0_x64-setup.exe"]) {
    assert.equal(matchesRelease(file, current), false, file);
  }
  assert.equal(matchesRelease("Coucou_0.3.0_x64_en-US.msi", { ...current, suffix: ".msi" }), true);
});
test("pack retains Tauri Linux naming without selecting another release", () => {
  const linux = { ...current, platform: "linux", suffix: ".deb" };
  assert.equal(matchesRelease("coucou_0.3.0_amd64.deb", linux), true);
  assert.equal(matchesRelease("coucou_0.2.0_amd64.deb", linux), false);
  assert.equal(matchesRelease("coucou_0.3.0-beta_amd64.deb", linux), false);
  assert.equal(matchesRelease("coucou-0.3.0-beta.x86_64.rpm", { ...linux, suffix: ".rpm" }), false);
  assert.equal(matchesRelease("coucou-0.3.0-1.x86_64.rpm", { ...linux, suffix: ".rpm" }), true);
  assert.equal(matchesRelease("Coucou_0.3.0_aarch64.AppImage", { ...linux, architecture: "arm64", suffix: ".AppImage" }), true);
});
