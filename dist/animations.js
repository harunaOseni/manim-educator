export function createCanvasController({ send, getToken }) {
  let video = document.getElementById("lesson-video");
  let nextVideo = document.getElementById("lesson-video-next");
  const writing = document.getElementById("lesson-writing");
  const urls = new Map();
  let nextTitle = "";
  const title = document.getElementById("lesson-title");
  const panel = document.getElementById("lesson-panel");
  const responses = new Map();
  const processedCalls = new Set();
  let revision = 0;
  let disposed = false;
  let playbackReady = false;
  let awaitingNarration = false;
  let narrationTimer = null;
  let boardSteps = [];
  let revealedSteps = 0;
  let spokenMilliseconds = 0;
  let lastAudioFrame = null;

  function revealNextStep() {
    if (revealedSteps >= boardSteps.length) return;
    const step = boardSteps[revealedSteps++];
    step.hidden = false;
    step.classList.add("is-revealed");
    step.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  async function request(path, options = {}) {
    const response = await fetch(`/api/animations${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || "The animation could not be loaded.");
    }
    return response;
  }
  function notify(content) {
    if (disposed) return;
    send({
      type: "session.thinking.append",
      event_id: crypto.randomUUID(),
      delegation_id: null,
      content,
    });
  }
  function clearVideo(target) {
    target.pause();
    target.removeAttribute("src");
    target.load();
    if (urls.has(target)) URL.revokeObjectURL(urls.get(target));
    urls.delete(target);
  }
  function writeBoard(call) {
    try {
      const input = JSON.parse(call.arguments);
      if (
        typeof input.title !== "string" ||
        input.title.length > 120 ||
        !Array.isArray(input.lines) ||
        !input.lines.length ||
        input.lines.length > 4 ||
        input.lines.some(
          (line) =>
            !line ||
            typeof line.label !== "string" ||
            line.label.length > 100 ||
            typeof line.latex !== "string" ||
            !line.latex.trim() ||
            line.latex.length > 1200,
        )
      ) {
        throw new Error("Invalid board content.");
      }
      // Typeset offscreen first so malformed math cannot replace a valid board.
      const steps = input.lines.map((line) => {
        const step = document.createElement("section");
        step.className = "board-step";
        step.hidden = true;
        const label = document.createElement("p");
        label.className = "step-label";
        label.textContent = line.label;
        const equation = document.createElement("div");
        equation.className = "step-equation";
        katex.render(line.latex, equation, {
          displayMode: true,
          throwOnError: true,
          trust: false,
          maxExpand: 500,
          maxSize: 12,
        });
        step.append(label, equation);
        return step;
      });
      revision++;
      awaitingNarration = false;
      clearTimeout(narrationTimer);
      video.pause();
      playbackReady = false;
      boardSteps = steps;
      revealedSteps = 0;
      spokenMilliseconds = 0;
      lastAudioFrame = null;
      writing.replaceChildren(...steps);
      revealNextStep();
      writing.classList.remove("is-covered");
      video.classList.remove("is-visible");
      title.textContent = input.title;
      panel.hidden = false;
      send({
        type: "session.commentary.append",
        event_id: crypto.randomUUID(),
        delegation_id: null,
        content: `The board now shows: ${input.lines.map((line) => `${line.label}: ${line.latex}`).join("; ")}. The first step is visible; further steps appear after each few seconds of your speech. Explain these steps in order at a calm pace while the backend continues. Do not announce loading or promise an animation.`,
      });
      return {
        status: "written",
        instruction:
          "The first typeset step is visible now; later steps reveal during speech. Continue with a short animation of the key change, without announcing rendering.",
        ...input,
      };
    } catch (error) {
      return { status: "failed", error: error.message };
    }
  }
  async function playReadyVideo(blob, expectedRevision) {
    const target = nextVideo;
    clearVideo(target);
    const url = URL.createObjectURL(blob);
    urls.set(target, url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => done(new Error("The animation could not be loaded.")),
        15000,
      );
      function done(error) {
        clearTimeout(timer);
        target.removeEventListener("loadeddata", loaded);
        target.removeEventListener("error", failed);
        if (error) reject(error);
        else resolve();
      }
      const loaded = () => done();
      const failed = () =>
        done(new Error("The animation could not be played."));
      target.addEventListener("loadeddata", loaded, { once: true });
      target.addEventListener("error", failed, { once: true });
      target.src = url;
      target.load();
    });
    if (disposed || revision !== expectedRevision)
      throw new Error("Animation superseded.");
    video.pause();
    video.classList.remove("is-visible");
    target.classList.add("is-visible");
    writing.classList.add("is-covered");
    [video, nextVideo] = [target, video];
    title.textContent = nextTitle;
    panel.hidden = false;
    playbackReady = true;
    return "ready_for_narration";
  }
  async function render(call) {
    const currentRevision = ++revision;
    try {
      const input = JSON.parse(call.arguments);
      nextTitle = input.title;
      const jobResponse = await request("", {
        method: "POST",
        body: JSON.stringify(input),
      });
      const job = await jobResponse.json();
      const deadline = Date.now() + 250000;
      let result = job;
      while (["rendering", "repairing"].includes(result.state)) {
        if (disposed || revision !== currentRevision)
          throw new Error("Animation cancelled.");
        if (Date.now() > deadline)
          throw new Error("Rendering took too long. Please try again.");
        await new Promise((resolve) => setTimeout(resolve, 600));
        result = await (await request(`/${job.id}`)).json();
      }
      if (result.state !== "ready")
        throw new Error(result.error || "Animation cancelled.");
      if (disposed || revision !== currentRevision)
        throw new Error("Animation superseded.");
      const blob = await (await request(`/${job.id}/video`)).blob();
      const state = await playReadyVideo(blob, currentRevision);
      return {
        status: state,
        title: result.title,
        narration: result.narration,
        instruction:
          "The first frame is visible. The animation will start with your next audible speech. Explain the supplied narration now, in sequence, without another tool call.",
      };
    } catch (error) {
      return {
        status: "failed",
        error: error.message,
        instruction:
          "Acknowledge the problem and continue verbally. Do not claim an animation is visible.",
      };
    }
  }
  function continueResponse(response) {
    if (
      disposed ||
      response.continued ||
      !response.completed ||
      response.pending > 0 ||
      response.results.length === 0
    )
      return;
    response.continued = true;
    awaitingNarration = response.results.some(
      (result) => result.output.status === "ready_for_narration",
    );
    for (const { callId, output } of response.results) {
      send({
        type: "response.item.create",
        event_id: crypto.randomUUID(),
        item: {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(output),
        },
      });
    }
    send({ type: "response.create", event_id: crypto.randomUUID() });
    if (awaitingNarration) {
      narrationTimer = setTimeout(() => startPlayback(), 4000);
    }
  }
  function handleEvent(envelope) {
    if (disposed) return;
    if (
      envelope.type === "session.input_transcript.delta" &&
      playbackReady &&
      (!video.paused || awaitingNarration)
    ) {
      awaitingNarration = false;
      clearTimeout(narrationTimer);
      video.pause();
      notify(
        "The animation has paused because the learner is speaking. Respond to their question; continue teaching from the current frame.",
      );
    }
    if (envelope.type !== "response.event") return;
    const event = envelope.event;
    const key = envelope.delegation_id;
    if (!event || !key) return;
    if (event.type === "response.created") {
      responses.set(key, {
        pending: 0,
        results: [],
        completed: false,
        continued: false,
      });
    }
    const response = responses.get(key);
    if (!response) return;
    if (
      event.type === "response.output_item.done" &&
      event.item?.type === "function_call" &&
      ["render_animation", "write_on_board"].includes(event.item.name)
    ) {
      const call = event.item;
      if (processedCalls.has(call.call_id)) return;
      processedCalls.add(call.call_id);
      response.pending++;
      Promise.resolve(
        call.name === "write_on_board" ? writeBoard(call) : render(call),
      ).then((output) => {
        response.results.push({ callId: call.call_id, output });
        response.pending--;
        continueResponse(response);
      });
    }
    if (event.type === "response.completed") {
      response.completed = true;
      continueResponse(response);
    }
  }
  function startPlayback() {
    if (!awaitingNarration || !playbackReady || disposed) return;
    awaitingNarration = false;
    clearTimeout(narrationTimer);
    video.play().catch(() => {
      notify(
        "Animation playback failed. Continue teaching from the visible board.",
      );
    });
  }
  return {
    handleEvent,
    handleAudioActivity(outputLevel) {
      const now = performance.now();
      const elapsed =
        lastAudioFrame === null ? 0 : Math.min(100, now - lastAudioFrame);
      lastAudioFrame = now;
      if (outputLevel >= 0.015) {
        startPlayback();
        if (!playbackReady && revealedSteps < boardSteps.length) {
          spokenMilliseconds += elapsed;
          if (spokenMilliseconds >= 3500) {
            spokenMilliseconds = 0;
            revealNextStep();
          }
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      const token = getToken();
      if (token)
        fetch("/api/animations", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        }).catch(() => {});
      clearTimeout(narrationTimer);
      clearVideo(video);
      clearVideo(nextVideo);
      panel.hidden = true;
    },
  };
}
