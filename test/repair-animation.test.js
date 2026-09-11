import { test } from "node:test";
import assert from "node:assert/strict";
import { createRenderer } from "../lib/repair-animation.js";

test("repairs a generated code error once and rerenders in the same sandbox", async () => {
  const calls = [];
  let repairs = 0;
  const render = createRenderer({
    apiKey: "test-key",
    render: async (code) => {
      calls.push(code);
      if (code === "broken") {
        const error = new Error("Failed");
        error.diagnostic = "NameError: bad_label";
        throw error;
      }
      return Buffer.from("video");
    },
    upstream: async (_url, options) => {
      repairs++;
      assert.equal(options.headers.Authorization, "Bearer test-key");
      assert.ok(JSON.parse(options.body).input.includes("NameError"));
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ code: "corrected" }),
              },
            ],
          },
        ],
      });
    },
  });
  const states = [];
  const video = await render("broken", {
    onRepair: () => states.push("repairing"),
  });
  assert.equal(video.toString(), "video");
  assert.deepEqual(calls, ["broken", "corrected"]);
  assert.equal(repairs, 1);
  assert.deepEqual(states, ["repairing"]);
});

test("does not retry infrastructure errors or endlessly repair bad code", async () => {
  let repairs = 0;
  const render = createRenderer({
    apiKey: "test-key",
    render: async () => {
      const error = new Error("bad code");
      error.diagnostic = "syntax error";
      throw error;
    },
    upstream: async () => {
      repairs++;
      return Response.json({
        output: [
          {
            content: [{ type: "output_text", text: '{"code":"still broken"}' }],
          },
        ],
      });
    },
  });
  await assert.rejects(render("broken"), /bad code/);
  assert.equal(repairs, 1);
  const unavailable = createRenderer({
    render: async () => {
      throw new Error("Docker unavailable");
    },
    upstream: async () => {
      throw new Error("must not call");
    },
  });
  await assert.rejects(unavailable("code"), /Docker unavailable/);
});
