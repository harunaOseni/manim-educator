import { loadEnvFile } from "node:process";
import { writeFile, mkdir } from "node:fs/promises";
import { createModalRenderer } from "../lib/modal-renderer.js";
loadEnvFile(new URL("../.env", import.meta.url));
const render = createModalRenderer();
const started = Date.now();
const video = await render(`from manim import *
class Explanation(Scene):
    def construct(self):
        self.camera.background_color = "#0e1119"
        equation = MathTex(r"2x+y=3", font_size=48)
        self.add(equation)
        self.play(equation.animate.shift(UP), run_time=1)
        self.wait(0.5)
`);
await mkdir(new URL("../build/", import.meta.url), { recursive: true });
await writeFile(new URL("../build/modal-check.mp4", import.meta.url), video);
console.log(
  `Modal rendered ${video.length} bytes in ${Date.now() - started} ms; saved build/modal-check.mp4.`,
);
