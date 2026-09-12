import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export const MANIM_IMAGE = "manimcommunity/manim:v0.19.0";
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
export const MANIM_RUNNER = `
import sys, json, os, subprocess, pathlib, base64, resource
resource.setrlimit(resource.RLIMIT_FSIZE, (33554432, 33554432))
resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
request = json.load(sys.stdin)
os.chdir('/tmp')
pathlib.Path('/tmp/scene.py').write_text(request['code'])
with open('/tmp/render.log', 'w+') as log:
    result = subprocess.run(['manim', 'render', '-ql', '--fps', '24', '--resolution', '960,540', '--disable_caching', '--media_dir', '/tmp/media', '-o', 'explanation.mp4', '/tmp/scene.py', 'Explanation'], stdout=log, stderr=log, timeout=80)
    log.seek(0)
    diagnostic = log.read()[-5000:]
output = pathlib.Path('/tmp/media/videos/scene/540p24/explanation.mp4')
if result.returncode != 0 or not output.is_file():
    print(json.dumps({'error': 'Manim could not render this explanation.', 'diagnostic': diagnostic}))
    sys.exit(1)
if output.stat().st_size > 16 * 1024 * 1024:
    raise ValueError('Animation exceeded output limit')
print(json.dumps({'video': base64.b64encode(output.read_bytes()).decode()}))
`;

export function renderManim(code, { signal, timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Rendering cancelled."));
    const name = `manim-${randomUUID()}`;
    // No host mounts or credentials. All generated code and files stay in capped tmpfs.
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "768m",
        "--memory-swap",
        "768m",
        "--cpus",
        "2",
        "--pids-limit",
        "64",
        "--ulimit",
        "fsize=33554432:33554432",
        "--tmpfs",
        "/tmp:rw,nosuid,size=256m,mode=1777",
        "-e",
        "HOME=/tmp",
        "-e",
        "XDG_CACHE_HOME=/tmp/cache",
        "-e",
        "OPENBLAS_NUM_THREADS=1",
        "-i",
        MANIM_IMAGE,
        "python",
        "-c",
        MANIM_RUNNER,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "",
      size = 0,
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(result);
    };
    const stop = (message) => {
      const remover = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
      remover.on("error", () => {});
      child.kill("SIGKILL");
      finish(new Error(message));
    };
    const cancel = () => stop("Rendering cancelled.");
    const timer = setTimeout(
      () => stop("Rendering took too long. Try a simpler explanation."),
      timeoutMs,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES)
        return stop("Animation exceeded the output limit.");
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-5000);
    });
    child.on("error", () =>
      finish(
        new Error(
          "The animation renderer is unavailable. Start Docker and try again.",
        ),
      ),
    );
    child.on("close", (exitCode) => {
      if (settled) return;
      try {
        const result = JSON.parse(stdout);
        if (exitCode !== 0 || !result.video) {
          const error = new Error(result.error || "Rendering failed.");
          error.diagnostic = result.diagnostic;
          throw error;
        }
        const video = Buffer.from(result.video, "base64");
        if (video.length < 12 || video.toString("ascii", 4, 8) !== "ftyp")
          throw new Error("The renderer returned an invalid video.");
        finish(null, video);
      } catch (error) {
        const failure = new Error(
          stderr.includes("daemon")
            ? "Start Docker to render animations."
            : "Could not render the animation. Please ask the tutor to try again.",
        );
        failure.diagnostic = error.diagnostic;
        finish(failure);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ code }));
  });
}
