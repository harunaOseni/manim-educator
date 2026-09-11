import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";
try {
  loadEnvFile(new URL(".env", import.meta.url));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const files = {
  "/": ["index.html", "text/html"],
  "/index.html": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
};
const VOICE_SESSION_CONFIG = {
  model: "gpt-live-1",
  store: false,
  instructions:
    "You are a warm, concise math tutor. Let the learner choose the topic. Listen to interruptions and adapt immediately. Explain one idea at a time and check understanding. Delegate mathematical reasoning to the backend. The canvas is currently empty and animations are not available yet; never claim to show or draw anything.",
  delegation: {
    type: "responses",
    responses: {
      model: "gpt-5.6-terra",
      instructions:
        "Solve the learner’s math question accurately using conversation context. Return a concise explanation suitable for speech. No animation tools are available.",
    },
  },
};

async function handleSessionRequest(req, reply, { apiKey, upstream }) {
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const allowed = [
    `http://localhost:${req.socket.localPort}`,
    `http://127.0.0.1:${req.socket.localPort}`,
  ];
  if (!allowed.includes(req.headers.origin))
    return reply(403, { error: "Unexpected request origin" });
  if (!apiKey)
    return reply(503, { error: "Voice is not configured on the server." });
  let body = "";
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 65536)
        return reply(413, { error: "Connection request is too large." });
    }
    const { sdp } = JSON.parse(body);
    if (typeof sdp !== "string" || !sdp.startsWith("v=0"))
      return reply(400, { error: "Invalid connection offer." });
    const result = await upstream("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        session: VOICE_SESSION_CONFIG,
        transport: { type: "webrtc", sdp },
      }),
    });
    if (!result.ok) {
      console.error("Live session rejected:", result.status);
      return reply(result.status === 429 ? 429 : 502, {
        error:
          result.status === 429
            ? "Voice is busy or usage is limited. Try again shortly."
            : "Could not connect to GPT-Live. Check the server’s API access and try again.",
      });
    }
    const data = await result.json();
    if (!data.transport?.sdp || !data.session?.id)
      return reply(502, {
        error: "The voice service returned an invalid connection.",
      });
    return reply(201, {
      session: { id: data.session.id },
      transport: { type: "webrtc", sdp: data.transport.sdp },
    });
  } catch (e) {
    return reply(e instanceof SyntaxError ? 400 : 502, {
      error:
        e instanceof SyntaxError
          ? "Invalid request."
          : "Voice connection failed. Please try again.",
    });
  }
}

export function makeServer({
  apiKey = process.env.OPENAI_API_KEY,
  upstream = fetch,
} = {}) {
  return createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/api/session") {
      return handleSessionRequest(req, reply, { apiKey, upstream });
    }
    const file = files[path];
    if (!file || req.method !== "GET") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    try {
      const data = await readFile(
        new URL(`./dist/${file[0]}`, import.meta.url),
      );
      res.writeHead(200, {
        "Content-Type": `${file[1]}; charset=utf-8`,
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Unable to load interface");
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 4174);
  makeServer().listen(port, "127.0.0.1", () =>
    console.log(`Manim Educator: http://localhost:${port}`),
  );
}
