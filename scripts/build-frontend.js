import { cp, mkdir, writeFile } from "node:fs/promises";

const configured = process.env.API_ORIGIN;
if (!configured)
  throw new Error("Set API_ORIGIN to the Railway backend HTTPS origin.");
const origin = new URL(configured);
if (
  origin.protocol !== "https:" ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
) {
  throw new Error(
    "API_ORIGIN must be an HTTPS origin without credentials, paths, or query parameters.",
  );
}
const output = new URL("../build/site/", import.meta.url);
await mkdir(output, { recursive: true });
await cp(new URL("../dist/", import.meta.url), output, { recursive: true });
await writeFile(
  new URL("_redirects", output),
  `/api/* ${origin.origin}/api/:splat 200!\n`,
);
console.log("Frontend built with Railway API proxy.");
