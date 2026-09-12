import { renderManim } from "./manim-renderer.js";
import { createModalRenderer } from "./modal-renderer.js";

export function createRenderProvider(
  provider = process.env.RENDER_PROVIDER ||
    (process.env.NODE_ENV === "production" ? "modal" : "docker"),
) {
  if (provider === "modal") return createModalRenderer();
  if (provider === "docker") return renderManim;
  throw new Error(`Unknown render provider: ${provider}`);
}
