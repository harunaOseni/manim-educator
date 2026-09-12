import { test } from "node:test";
import assert from "node:assert/strict";
import { createModalRenderer } from "../lib/modal-renderer.js";

const video = Buffer.from("00000000667479706d703432", "hex");
function setup({
  result = { video: video.toString("base64") },
  exitCode = 0,
  delayedCreate = false,
  oversized = false,
} = {}) {
  let options,
    writes = "",
    terminated = 0,
    resolveCreate;
  const sandbox = {
    stdout: (async function* () {
      yield oversized ? "x".repeat(25 * 1024 * 1024) : JSON.stringify(result);
    })(),
    stderr: (async function* () {})(),
    wait: async () => exitCode,
    stdin: {
      async writeText(value) {
        writes += value;
      },
      async close() {},
    },
    async terminate() {
      terminated++;
    },
  };
  const client = {
    apps: { fromName: async () => ({}) },
    images: { fromName: async () => ({}) },
    sandboxes: {
      create: async (app, image, value) => {
        options = value;
        return delayedCreate
          ? new Promise((resolve) => {
              resolveCreate = () => resolve(sandbox);
            })
          : sandbox;
      },
    },
  };
  return {
    render: createModalRenderer({ client }),
    options: () => options,
    writes: () => writes,
    terminated: () => terminated,
    finishCreate: () => resolveCreate(),
  };
}

test("Modal uses an isolated bounded sandbox, returns video and terminates it", async () => {
  const h = setup();
  assert.deepEqual(await h.render("scene source"), video);
  assert.equal(JSON.parse(h.writes()).code, "scene source");
  assert.equal(h.options().blockNetwork, true);
  assert.equal(h.options().includeOidcIdentityToken, false);
  assert.equal(h.options().memoryLimitMiB, 768);
  assert.equal(h.options().cpuLimit, 2);
  assert.equal(h.options().timeoutMs, 90000);
  assert.equal(h.options().secrets, undefined);
  assert.equal(h.options().env.OPENAI_API_KEY, undefined);
  assert.equal(h.options().env.MODAL_TOKEN_SECRET, undefined);
  assert.equal(h.terminated(), 1);
});

test("Modal render errors retain bounded diagnostics for one repair attempt", async () => {
  const h = setup({ result: { diagnostic: "bad scene" }, exitCode: 1 });
  await assert.rejects(
    h.render("bad code"),
    (error) => error.diagnostic === "bad scene",
  );
  assert.equal(h.terminated(), 1);
});

test("cancellation during creation also terminates a late sandbox", async () => {
  const h = setup({ delayedCreate: true });
  const controller = new AbortController();
  const rendering = h.render("code", { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(rendering, /cancelled/);
  h.finishCreate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.terminated(), 1);
  assert.equal(h.writes(), "");
});

test("rejects oversized output and still terminates the sandbox", async () => {
  const h = setup({ oversized: true });
  await assert.rejects(h.render("code"), /output limit/);
  assert.equal(h.terminated(), 1);
});

test("timeout during creation cleans up a late sandbox", async () => {
  const h = setup({ delayedCreate: true });
  await assert.rejects(h.render("code", { timeoutMs: 10 }), /too long/);
  h.finishCreate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.terminated(), 1);
});
