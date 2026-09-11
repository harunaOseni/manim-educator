import { createRenderer } from "./lib/repair-animation.js";
import { animationTool, boardTool } from "./lib/animation-tool.js";
import { createAnimationJobs } from "./lib/animation-jobs.js";
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
  "/animations.js": ["animations.js", "text/javascript"],
  "/app.js": ["app.js", "text/javascript"],
};
const VOICE_SESSION_CONFIG = {
  model: "gpt-live-1",
  store: false,
  instructions: `You are a warm, concise visual math tutor. Let the learner choose the topic and explain one idea at a time.
Backchannel policy: Acknowledge naturally and briefly.
Interruption policy: Stop speaking when the learner interrupts and listen.
Delegation policy:
Backend tools:
- Visual mathematics: solve equations, explain mathematical concepts, and render Manim animations on the learner's canvas.
Delegate to the backend when:
- The learner gives a new equation or asks to understand a mathematical concept, even without explicitly asking for a visual.
- The learner asks to see a graph, diagram, or animation.
- A correction changes the explanation being prepared.
Do not delegate to the backend when:
- The learner greets you or acknowledges an explanation.
- You need a brief clarification or can answer from a completed, still-current visual.
Delegate before promising or explaining a visual. Do not claim work has started until the backend has been invoked. Teach from the board as it develops. Avoid announcing creation, rendering, or readiness. Wait for the backend's ready result before describing animated motion. Keep tool procedures in the backend.`,
  delegation: {
    type: "responses",
    responses: {
      model: "gpt-5.6-terra",
      tools: [boardTool, animationTool],
      reasoning: { effort: "low" },
      parallel_tool_calls: false,
      instructions:
        "Solve the learner’s math question accurately using conversation context. Return a concise explanation suitable for speech. For every substantive math question, first call write_on_board with useful typeset equations and short step labels immediately, before generating animation source. Then use render_animation to teach it visually even if the learner did not explicitly say animation. Skip rendering for greetings, acknowledgments, and purely conversational replies. Verify the entire requested expression before giving a final answer. For an integral, include every additive term and the integration constant, and differentiate the proposed answer to check it. Label intermediate or partial work explicitly; never equate a partial antiderivative with the full integral. Keep the first animation frame consistent with the board you wrote so the transition feels continuous. Generate a specific mathematically accurate scene for the current question, not a generic title card. Call at most one render_animation per response. After the tool returns ready_for_narration, narrate the supplied explanation once and pause for the learner. If rendering failed, acknowledge it and continue teaching verbally; retry only if asked. Never call the tool repeatedly for the same question.",
    },
  },
};

async function handleSessionRequest(req, reply, { apiKey, upstream, jobs }) {
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
      animationToken: jobs.issueToken(),
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

async function handleAnimationRequest(req, res, reply, path, jobs) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!jobs.has(token))
    return reply(401, { error: "Voice session has expired." });
  const origin = req.headers.origin;
  const allowed = [
    `http://localhost:${req.socket.localPort}`,
    `http://127.0.0.1:${req.socket.localPort}`,
  ];
  if (req.method !== "GET" && !allowed.includes(origin))
    return reply(403, { error: "Unexpected request origin" });
  try {
    if (path === "/api/animations" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 65536)
          return reply(413, { error: "Animation request is too large." });
      }
      return reply(202, jobs.start(token, JSON.parse(body)));
    }
    if (path === "/api/animations" && req.method === "DELETE") {
      jobs.release(token);
      return reply(200, { state: "closed" });
    }
    const match = path.match(/^\/api\/animations\/([a-f0-9-]+)(\/video)?$/);
    if (!match) return reply(404, { error: "Animation not found." });
    const job = jobs.get(token, match[1]);
    if (!job) return reply(404, { error: "Animation not found." });
    if (req.method === "DELETE") {
      jobs.cancel(token);
      return reply(200, { state: "cancelled" });
    }
    if (req.method !== "GET")
      return reply(405, { error: "Method not allowed" });
    if (!match[2]) return reply(200, job);
    const video = jobs.video(token, match[1]);
    if (!video) return reply(409, { error: "Animation is not ready." });
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": video.length,
      "Cache-Control": "no-store",
    });
    res.end(video);
  } catch (error) {
    return reply(400, {
      error:
        error instanceof SyntaxError
          ? "Invalid animation request."
          : error.message,
    });
  }
}

export function makeServer({
  apiKey = process.env.OPENAI_API_KEY,
  upstream = fetch,
  jobs = createAnimationJobs({ render: createRenderer({ apiKey, upstream }) }),
} = {}) {
  const server = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/api/session") {
      return handleSessionRequest(req, reply, { apiKey, upstream, jobs });
    }
    if (path.startsWith("/api/animations")) {
      return handleAnimationRequest(req, res, reply, path, jobs);
    }
    const vendor = path.match(
      /^\/vendor\/katex\/(katex\.min\.(js|css)|fonts\/[A-Za-z0-9_-]+\.(woff2?|ttf))$/,
    );
    const vendorType =
      vendor &&
      (path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".woff2")
            ? "font/woff2"
            : path.endsWith(".woff")
              ? "font/woff"
              : "font/ttf");
    const file = files[path] || (vendor && [path.slice(1), vendorType]);
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
  server.on("close", () => jobs.close());
  return server;
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
