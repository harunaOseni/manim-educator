# Local development

Use Node.js 22.6+ and Docker Desktop. Place `OPENAI_API_KEY` in the ignored `.env` file, start Docker, and prepare the renderer once:

```sh
docker pull manimcommunity/manim:v0.19.0
npm start
```

Open http://localhost:4174. Start a fresh voice session, choose a math topic, and ask for an animated explanation. The tutor's backend first writes LaTeX equations with short plain-text labels using `write_on_board`, then generates a short Manim animation. The existing board stays visible while the next video loads in a second layer, then crossfades into it. KaTeX and its fonts are served locally from `dist/vendor/katex`; rendering disables trusted commands and rejects invalid equations before replacing the board. The first step appears immediately and each subsequent step appears after 3.5 seconds of detected tutor speech (approximate pacing, not semantic alignment). Silence does not advance the board. There are no replay controls or render-status overlays. Playback begins with tutor audio, with a four-second fallback if narration is delayed. Speaking pauses the video and preserves its frame.

The Node server creates GPT-Live sessions and exposes a per-session capability token for render jobs. Generated Python runs only inside Docker with no host mounts, no network or API keys, a read-only root filesystem, bounded temporary storage, and CPU, memory, process, output, and wall-clock limits. A generated-code error gets one server-side repair attempt and a second isolated render; infrastructure errors do not trigger model retries. The current render is held in memory and removed on session end or expiry. This server binds to localhost; public hosting and access controls belong to the rollout ticket.

Voice uses the GPT-Live Responses delegation tool flow: collect completed function calls, execute the render, wait for the delegated response to finish, submit function outputs, then continue the response. Playback starts on measured tutor audio rather than a transcript timestamp. Narration is conversational, not frame-accurate dubbing.

Run checks with `npm run check` and `npm test`. Unit tests use fake media and model connections. Also verify a real spoken question, render, interruption, follow-up, and session end before closing the learning-loop ticket.

# Production rendering with Modal

Production uses `RENDER_PROVIDER=modal`; local development defaults to `docker`.
Railway holds the OpenAI and Modal credentials and coordinates jobs. Every render
runs in a fresh Modal sandbox using a prepared Manim image. No credentials,
volumes, or public ports are passed into the sandbox; networking and OIDC identity
injection are disabled. Each sandbox has a 90-second lifetime, two-CPU hard limit,
768 MiB memory hard limit, and process/file-size limits. Video and collected output
sizes are checked before accepting a result. Modal manages the sandbox filesystem;
it does not use the local Docker renderer's read-only-root/tmpfs configuration.
The sandbox is terminated after success, failure, or cancellation. If termination
cannot reach Modal, its provider-side lifetime is the final cleanup bound.

Add `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` to the ignored `.env` file, then run:

```sh
npm run prepare:modal
npm run check:modal
RENDER_PROVIDER=modal npm start
```

`prepare:modal` creates the `manim-educator` Modal app and publishes the prepared
`manim-renderer:v0.19.0` image. Runtime jobs reference that image without building
it again. `check:modal` performs a real isolated render and writes
`build/modal-check.mp4`. It requires working Modal credentials. Unit tests use a
fake Modal client and do not prove cloud availability or latency.

# Netlify and Railway

Railway builds `Dockerfile`, listens on `0.0.0.0:$PORT`, and exposes `/health`
for process liveness. A successful healthcheck alone does not verify rendering.
Configure Railway with `OPENAI_API_KEY`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`,
and `FRONTEND_ORIGIN` equal to the exact production Netlify HTTPS origin.
Use one API replica while render jobs and session tokens are stored in memory.

Configure Netlify with `API_ORIGIN` equal to the Railway HTTPS origin.
`npm run build:frontend` copies the frontend into `build/site` and generates an
API proxy rule; browser code continues making same-origin `/api` calls. Never put
OpenAI or Modal credentials in Netlify frontend environment variables or assets.

After deploying, verify voice, a real render, a follow-up, cancellation, and session
cleanup through the production Netlify URL before marking rollout complete.
