import { test } from "node:test";
import assert from "node:assert/strict";
import { makeServer } from "../server.js";
async function run(options, check) {
  const server = makeServer(options);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await check(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
test("rejects foreign origins and never serves env files", () =>
  run(
    {
      apiKey: "secret",
      upstream: () => {
        throw Error("must not call");
      },
    },
    async (base) => {
      assert.equal(
        (
          await fetch(base + "/api/session", {
            method: "POST",
            headers: { Origin: "https://foreign.example" },
          })
        ).status,
        403,
      );
      assert.equal((await fetch(base + "/.env")).status, 404);
    },
  ));
test("validates offers and returns only public connection fields", () =>
  run(
    {
      apiKey: "secret",
      upstream: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/live/sessions");
        assert.equal(options.headers.Authorization, "Bearer secret");
        assert.equal(JSON.parse(options.body).session.model, "gpt-live-1");
        return Response.json({
          session: { id: "live_test" },
          transport: { sdp: "answer" },
          private: "do-not-return",
        });
      },
    },
    async (base) => {
      const post = (body) =>
        fetch(base + "/api/session", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      assert.equal((await post({ sdp: "" })).status, 400);
      const res = await post({ sdp: "v=0\r\n" });
      assert.equal(res.status, 201);
      assert.deepEqual(await res.json(), {
        session: { id: "live_test" },
        transport: { type: "webrtc", sdp: "answer" },
      });
    },
  ));
test("sanitizes upstream failures", () =>
  run(
    {
      apiKey: "secret",
      upstream: async () => new Response("secret diagnostic", { status: 401 }),
    },
    async (base) => {
      const res = await fetch(base + "/api/session", {
        method: "POST",
        headers: { Origin: base },
        body: JSON.stringify({ sdp: "v=0" }),
      });
      assert.equal(res.status, 502);
      assert.ok(!(await res.text()).includes("secret"));
    },
  ));
