import { ModalClient } from "modal";
import { MANIM_RUNNER } from "./manim-renderer.js";

export const MODAL_APP = "manim-educator";
export const MODAL_IMAGE = "manim-renderer:v0.19.0";
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;

async function readBounded(stream, limit) {
  let text = "";
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) throw new Error("Animation exceeded the output limit.");
    text += chunk;
  }
  return text;
}

export function createModalRenderer({
  client,
  appName = process.env.MODAL_APP_NAME || MODAL_APP,
  imageName = process.env.MODAL_IMAGE_NAME || MODAL_IMAGE,
} = {}) {
  let runtime;
  function getRuntime() {
    if (!runtime) {
      const modal =
        client || new ModalClient({ timeoutMs: 20000, maxRetries: 2 });
      runtime = Promise.all([
        modal.apps.fromName(appName),
        modal.images.fromName(imageName),
      ])
        .then(([app, image]) => ({ modal, app, image }))
        .catch((error) => {
          runtime = null;
          throw error;
        });
    }
    return runtime;
  }

  return async function renderOnModal(
    code,
    { signal, timeoutMs = 90000 } = {},
  ) {
    if (signal?.aborted) throw new Error("Rendering cancelled.");
    let sandbox;
    let termination;
    let stopped = false;
    let timer;
    let cancel;
    const terminate = () => {
      if (!sandbox) return Promise.resolve();
      termination ||= sandbox.terminate().catch(() => {
        // The provider-side lifetime remains the final bound if cleanup cannot connect.
        console.error(
          "Modal sandbox cleanup failed; lifetime timeout remains active.",
        );
      });
      return termination;
    };
    const checkActive = () => {
      if (stopped || signal?.aborted) throw new Error("Rendering cancelled.");
    };
    const interrupted = new Promise((_, reject) => {
      const stop = (message) => {
        stopped = true;
        void terminate();
        reject(new Error(message));
      };
      cancel = () => stop("Rendering cancelled.");
      signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(
        () => stop("Rendering took too long. Try a simpler explanation."),
        timeoutMs,
      );
    });
    const work = async () => {
      const { modal, app, image } = await getRuntime();
      checkActive();
      sandbox = await modal.sandboxes.create(app, image, {
        command: ["python", "-c", MANIM_RUNNER],
        timeoutMs,
        cpu: 2,
        cpuLimit: 2,
        memoryMiB: 768,
        memoryLimitMiB: 768,
        blockNetwork: true,
        includeOidcIdentityToken: false,
        env: {
          HOME: "/tmp",
          XDG_CACHE_HOME: "/tmp/cache",
          OPENBLAS_NUM_THREADS: "1",
        },
      });
      // A create request may finish after local cancellation. Never leave that sandbox alive.
      if (stopped || signal?.aborted) {
        await terminate();
        checkActive();
      }
      const output = Promise.all([
        readBounded(sandbox.stdout, MAX_OUTPUT_BYTES),
        readBounded(sandbox.stderr, 65536),
        sandbox.wait(),
      ]);
      // Attach a handler while stdin is in flight to avoid an unhandled stream rejection.
      output.catch(() => {});
      await sandbox.stdin.writeText(JSON.stringify({ code }));
      await sandbox.stdin.close();
      const [stdout, , exitCode] = await output;
      checkActive();
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        throw new Error("The renderer returned an invalid response.");
      }
      if (exitCode !== 0 || !result.video) {
        const error = new Error(
          "Could not render the animation. Please ask the tutor to try again.",
        );
        if (typeof result.diagnostic === "string")
          error.diagnostic = result.diagnostic.slice(-5000);
        throw error;
      }
      const video = Buffer.from(result.video, "base64");
      if (
        video.length > 16 * 1024 * 1024 ||
        video.length < 12 ||
        video.toString("ascii", 4, 8) !== "ftyp"
      )
        throw new Error("The renderer returned an invalid video.");
      return video;
    };
    try {
      return await Promise.race([work(), interrupted]);
    } catch (error) {
      if (
        error.diagnostic ||
        stopped ||
        signal?.aborted ||
        error.message.startsWith("The renderer") ||
        error.message.startsWith("Animation exceeded")
      )
        throw error;
      throw new Error(
        "The hosted animation renderer is unavailable. Please try again.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      await terminate();
    }
  };
}
