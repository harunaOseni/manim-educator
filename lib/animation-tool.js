export const animationTool = {
  type: "function",
  name: "render_animation",
  description:
    "Render an original Manim animation for the learner's current math question. This takes time; wait for the result before describing the visible animation.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short learner-facing title." },
      narration: {
        type: "string",
        description:
          "A concise spoken explanation of what the animation demonstrates, in order, about 30-60 words.",
      },
      code: {
        type: "string",
        description:
          "Complete Python source using Manim Community 0.19.0. Define class Explanation(Scene). Render one clear 6-10 second animation with self.play and self.wait. Use from manim import * and numpy as np. Dark #0e1119 background; lavender, mint, and white. Keep content within x +/-6 and y +/-3.2. Font sizes 36-48; fit long labels. Use the available frame generously. Keep all curves inside their axes: choose ranges from actual function values and restrict plotted x intervals so no curve runs off-screen. Prefer one large graph over stacked tiny graphs. Use MathTex for formulas with Python raw strings and exactly one backslash per LaTeX command in the resulting Python source. For numeric coordinate labels, prefer clear decimals such as 1.5 rather than fractions. Never place LaTeX commands in Text objects. Avoid external files, network, sound, interactive input, SVG downloads, or configuring output paths. Place the initial mathematical diagram on screen with self.add before the first self.play; never start with an empty frame or a title-only hold. Keep source compact, reuse objects, and animate only the key change. Always finish with a short hold. Never invoke render() yourself.",
      },
    },
    required: ["title", "narration", "code"],
    additionalProperties: false,
  },
};

export function validateAnimation(input) {
  if (!input || typeof input !== "object")
    throw new Error("Invalid animation request.");
  for (const [key, limit] of [
    ["title", 120],
    ["narration", 1200],
    ["code", 24000],
  ]) {
    if (
      typeof input[key] !== "string" ||
      !input[key].trim() ||
      input[key].length > limit
    ) {
      throw new Error(`Invalid animation ${key}.`);
    }
  }
  return { title: input.title, narration: input.narration, code: input.code };
}

export const boardTool = {
  type: "function",
  name: "write_on_board",
  description:
    "Immediately write useful mathematics on the canvas before preparing an animation. Use LaTeX for equations and plain text only for short labels. The canvas reveals steps in order as the tutor speaks.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short topic title." },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Short plain-text teaching cue, not a paragraph.",
            },
            latex: {
              type: "string",
              description:
                "A single LaTeX equation without dollar delimiters. Use proper fractions and powers. Break long derivations across separate steps.",
            },
          },
          required: ["label", "latex"],
          additionalProperties: false,
        },
        description:
          "One to four concise steps in teaching order. Start with the complete problem. Label partial work as partial. A final answer must include every term of the original expression and + C for an indefinite integral.",
      },
    },
    required: ["title", "lines"],
    additionalProperties: false,
  },
};
