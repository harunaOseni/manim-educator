import { randomBytes, randomUUID } from "node:crypto";
import { renderManim } from "./manim-renderer.js";
import { validateAnimation } from "./animation-tool.js";

export function createAnimationJobs({ render = renderManim } = {}) {
  const sessions = new Map();
  let running = 0;
  const lifetime = 60 * 60 * 1000;
  function release(token) {
    const session = sessions.get(token);
    session?.job?.controller.abort();
    sessions.delete(token);
  }
  const sweeper = setInterval(() => {
    for (const [token, session] of sessions)
      if (session.expires < Date.now()) release(token);
  }, 60000);
  sweeper.unref();
  return {
    issueToken() {
      if (sessions.size >= 32) throw new Error("Too many active sessions.");
      const token = randomBytes(32).toString("hex");
      sessions.set(token, { expires: Date.now() + lifetime, job: null });
      return token;
    },
    has(token) {
      return sessions.has(token) && sessions.get(token).expires > Date.now();
    },
    start(token, input) {
      const request = validateAnimation(input);
      const session = sessions.get(token);
      if (!session) throw new Error("Session has expired.");
      if (["rendering", "repairing"].includes(session.job?.state))
        throw new Error("An animation is already rendering.");
      if (running >= 2)
        throw new Error("The renderer is busy. Try again shortly.");
      const job = {
        id: randomUUID(),
        title: request.title,
        narration: request.narration,
        state: "rendering",
        controller: new AbortController(),
        video: null,
      };
      session.job = job;
      running++;
      Promise.resolve()
        .then(() =>
          render(request.code, {
            signal: job.controller.signal,
            onRepair: () => {
              if (!job.controller.signal.aborted) job.state = "repairing";
            },
          }),
        )
        .then((video) => {
          if (job.controller.signal.aborted) return;
          job.video = video;
          job.state = "ready";
        })
        .catch((error) => {
          job.state = job.controller.signal.aborted ? "cancelled" : "failed";
          job.error = error.message;
        })
        .finally(() => {
          running--;
        });
      return this.get(token, job.id);
    },
    get(token, id) {
      const job = sessions.get(token)?.job;
      if (!job || job.id !== id) return null;
      return {
        id: job.id,
        title: job.title,
        narration: job.narration,
        state: job.state,
        error: job.error,
      };
    },
    video(token, id) {
      const job = sessions.get(token)?.job;
      return job?.id === id && job.state === "ready" ? job.video : null;
    },
    cancel(token) {
      const job = sessions.get(token)?.job;
      job?.controller.abort();
      if (job) {
        job.state = "cancelled";
        job.video = null;
      }
    },
    release,
    close() {
      clearInterval(sweeper);
      for (const token of sessions.keys()) release(token);
    },
  };
}
