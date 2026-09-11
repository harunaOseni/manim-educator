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
