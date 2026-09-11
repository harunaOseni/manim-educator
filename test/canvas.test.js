import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../dist/animations.js", import.meta.url),
  "utf8",
);
function setup() {
  const nodes = new Map(),
    sent = [];
  let plays = 0;
  let now = 0;
  let playbackFallback;
  let deferLoads = false;
  const loads = [];
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = new Map();
    const element = {
      classList: { add() {}, remove() {} },
      replaceChildren(...children) {
        this.children = children;
      },
      paused: true,
      hidden: true,
      textContent: "",
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
      removeAttribute() {},
      pause() {
        this.paused = true;
      },
      load() {
        if (this.src) {
          const loaded = () => listeners.get("loadeddata")?.();
          if (deferLoads) loads.push(loaded);
          else queueMicrotask(loaded);
        }
      },
      async play() {
        plays++;
        this.paused = false;
      },
    };
    nodes.set(id, element);
    return element;
  }
  const context = vm.createContext({
    document: {
      getElementById: node,
      createElement: () => ({
        textContent: "",
        classList: { add() {} },
        append(...children) {
          this.children = children;
        },
      }),
    },
    performance: { now: () => now },
    katex: {
      render(latex, element) {
        element.textContent = latex;
      },
    },
    crypto: { randomUUID: () => "event-id" },
    URL: { createObjectURL: () => "blob:video", revokeObjectURL() {} },
    setTimeout: (callback, delay) => {
      if (delay === 4000) {
        playbackFallback = callback;
        return 0;
      }
      return setTimeout(callback, delay);
    },
    clearTimeout,
    console,
    fetch: async (url, options = {}) => {
      if (options.method === "DELETE") return { ok: true };
      if (options.method === "POST")
        return {
          ok: true,
          json: async () => ({
            id: "job-1",
            state: "ready",
            title: "Area",
            narration: "The square grows.",
          }),
        };
      return { ok: true, blob: async () => new Blob(["video"]) };
    },
  });
  vm.runInContext(
    source.replace(/^import .*;\n/, "").replace("export function", "function") +
      "\nglobalThis.makeController = createCanvasController;",
    context,
  );
  const controller = context.makeController({
    send: (event) => sent.push(event),
    getToken: () => "token",
  });
  const emit = (event) =>
    controller.handleEvent({
      type: "response.event",
      delegation_id: "delegation-1",
      event,
    });
  return {
    controller,
    sent,
    emit,
    node,
    advanceAudio: (milliseconds, level) => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
        now += 100;
        controller.handleAudioActivity(level);
      }
    },
    plays: () => plays,
    deferLoads: () => {
      deferLoads = true;
    },
    finishLoads: () => loads.splice(0).forEach((fn) => fn()),
    firePlaybackFallback: () => playbackFallback?.(),
  };
}
test("waits for both rendering and response completion; submits each tool result once", async () => {
  const h = setup();
  try {
    h.controller.handleEvent({ type: "session.delegation.created" });
    assert.equal(h.node("lesson-panel").hidden, true);
    h.emit({ type: "response.created" });
    h.emit({
      type: "response.output_item.added",
      item: { type: "function_call", name: "render_animation" },
    });
    const event = {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: "render_animation",
        call_id: "call-1",
        arguments: JSON.stringify({
          title: "Area",
          narration: "The square grows.",
          code: "code",
        }),
      },
    };
    h.emit(event);
    h.emit(event);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.plays(), 0);
    assert.equal(h.sent.length, 0);
    h.emit({ type: "response.completed" });
    assert.deepEqual(
      h.sent.map((e) => e.type),
      ["response.item.create", "response.create"],
    );
    assert.equal(
      JSON.parse(h.sent[0].item.output).status,
      "ready_for_narration",
    );
    h.emit({ type: "response.completed" });
    assert.equal(h.sent.length, 2);
    h.controller.handleAudioActivity(0.05);
    assert.equal(h.plays(), 1);
    h.controller.handleEvent({
      type: "session.input_transcript.delta",
      delta: "Wait",
    });
    assert.equal(h.node("lesson-video-next").paused, true);
  } finally {
    h.controller.dispose();
  }
});

test("starts ready video if narration is delayed instead of leaving a blank frame", async () => {
  const h = setup();
  try {
    h.emit({ type: "response.created" });
    h.emit({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: "render_animation",
        call_id: "call-fallback",
        arguments: JSON.stringify({
          title: "Equation",
          narration: "The line crosses the axes.",
          code: "code",
        }),
      },
    });
    h.emit({ type: "response.completed" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.plays(), 0);
    h.firePlaybackFallback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.plays(), 1);
    assert.equal(h.node("lesson-panel").hidden, false);
    h.controller.handleAudioActivity(0.05);
    assert.equal(h.plays(), 1);
  } finally {
    h.controller.dispose();
  }
});

test("board tool writes real content immediately without starting a render", async () => {
  const h = setup();
  try {
    h.emit({ type: "response.created" });
    h.emit({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: "write_on_board",
        call_id: "board-1",
        arguments: JSON.stringify({
          title: "A line",
          lines: [
            { label: "Start", latex: "2x + y = 3" },
            { label: "Rearrange", latex: "y = 3 - 2x" },
          ],
        }),
      },
    });
    assert.equal(
      h.node("lesson-writing").children[0].children[1].textContent,
      "2x + y = 3",
    );
    assert.equal(h.node("lesson-panel").hidden, false);
    assert.equal(h.plays(), 0);
    const steps = h.node("lesson-writing").children;
    assert.equal(steps[0].hidden, false);
    assert.equal(steps[1].hidden, true);
    h.advanceAudio(5000, 0);
    assert.equal(steps[1].hidden, true);
    h.advanceAudio(3600, 0.05);
    assert.equal(steps[1].hidden, false);
    await new Promise((resolve) => setImmediate(resolve));
    h.emit({ type: "response.completed" });
    assert.equal(
      JSON.parse(
        h.sent.find((e) => e.type === "response.item.create").item.output,
      ).status,
      "written",
    );
  } finally {
    h.controller.dispose();
  }
});

test("keeps the displayed film intact until its replacement is decoded", async () => {
  const h = setup();
  const render = (id) => {
    h.emit({ type: "response.created" });
    h.emit({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: "render_animation",
        call_id: id,
        arguments: JSON.stringify({
          title: id,
          narration: "Math",
          code: "code",
        }),
      },
    });
    h.emit({ type: "response.completed" });
  };
  try {
    render("first");
    await new Promise((resolve) => setImmediate(resolve));
    const firstSource = h.node("lesson-video-next").src;
    assert.equal(h.node("lesson-title").textContent, "first");
    h.deferLoads();
    render("second");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.node("lesson-video-next").src, firstSource);
    assert.equal(h.node("lesson-title").textContent, "first");
    h.finishLoads();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.node("lesson-title").textContent, "second");
  } finally {
    h.controller.dispose();
  }
});
