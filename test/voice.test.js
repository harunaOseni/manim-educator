import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../dist/app.js", import.meta.url),
  "utf8",
);
function harness({ deferred = false } = {}) {
  const nodes = new Map();
  const element = (id) =>
    nodes.get(id) ||
    nodes
      .set(id, {
        textContent: "",
        style: { setProperty() {} },
        setAttribute(k, v) {
          this[k] = v;
        },
        addEventListener(k, v) {
          this[k] = v;
        },
        play: async () => {},
        pause() {},
      })
      .get(id);
  const track = {
    enabled: true,
    stop() {
      this.stopped = true;
    },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  let resolveMedia;
  class Peer {
    constructor() {
      Peer.last = this;
      this.iceGatheringState = "complete";
    }
    addTrack() {}
    createDataChannel() {
      return (this.dc = {
        readyState: "open",
        sent: [],
        send(e) {
          this.sent.push(JSON.parse(e));
        },
      });
    }
    async createOffer() {
      return { sdp: "v=0" };
    }
    async setLocalDescription(o) {
      this.localDescription = o;
    }
    async setRemoteDescription() {
      this.dc.onmessage({ data: JSON.stringify({ type: "session.started" }) });
    }
    close() {
      this.closed = true;
    }
  }
  class Context {
    async resume() {}
    async close() {
      this.closed = true;
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 256,
        getFloatTimeDomainData(a) {
          a.fill(0);
        },
      };
    }
  }
  const context = vm.createContext({
    document: { getElementById: element, body: { dataset: {} } },
    window: { RTCPeerConnection: Peer, addEventListener() {} },
    navigator: {
      mediaDevices: {
        getUserMedia: () =>
          deferred
            ? new Promise((r) => (resolveMedia = r))
            : Promise.resolve(stream),
      },
    },
    RTCPeerConnection: Peer,
    AudioContext: Context,
    AbortController,
    Float32Array,
    MediaStream: class {},
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({ transport: { sdp: "answer" } }),
    }),
  });
  vm.runInContext(source, context);
  return { element, track, Peer, stream, resolve: () => resolveMedia(stream) };
}
test("start, mute, unmute and graceful close release capture", async () => {
  const h = harness();
  await h.element("ask").click();
  assert.equal(h.element("voice-status").textContent, "Listening");
  h.element("mute").click();
  assert.equal(h.track.enabled, false);
  h.element("mute").click();
  assert.equal(h.track.enabled, true);
  h.element("end").click();
  assert.equal(h.Peer.last.dc.sent.at(-1).type, "session.close");
  assert.equal(h.track.enabled, false);
  h.Peer.last.dc.onmessage({ data: '{"type":"session.closed"}' });
  assert.equal(h.track.stopped, true);
  assert.equal(h.Peer.last.closed, true);
});
test("ending during permission request discards late microphone stream", async () => {
  const h = harness({ deferred: true });
  const pending = h.element("ask").click();
  await new Promise((r) => setImmediate(r));
  h.element("end").click();
  h.resolve();
  await pending;
  assert.equal(h.track.stopped, true);
  assert.equal(h.element("voice-status").textContent, "Talk to your tutor");
});
