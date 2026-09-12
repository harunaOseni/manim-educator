import { loadEnvFile } from "node:process";
import { ModalClient } from "modal";
import { MODAL_APP, MODAL_IMAGE } from "../lib/modal-renderer.js";
import { MANIM_IMAGE } from "../lib/manim-renderer.js";
try {
  loadEnvFile(new URL("../.env", import.meta.url));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
  throw new Error(
    "Add MODAL_TOKEN_ID and MODAL_TOKEN_SECRET to .env before preparing Modal.",
  );
}
const modal = new ModalClient();
const app = await modal.apps.fromName(process.env.MODAL_APP_NAME || MODAL_APP, {
  createIfMissing: true,
});
const image = modal.images.fromRegistry(MANIM_IMAGE);
await image.build(app);
await image.publish(process.env.MODAL_IMAGE_NAME || MODAL_IMAGE);
console.log("Manim image prepared on Modal.");
