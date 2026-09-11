import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnimationJobs } from "../lib/animation-jobs.js";
const input = {
  title: "Area",
  narration: "A square's area is its side squared.",
  code: "from manim import *",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("render jobs isolate ownership and return video only when ready", async () => {
  let complete;
  const jobs = createAnimationJobs({
    render: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  try {
    const owner = jobs.issueToken(),
      other = jobs.issueToken();
    const job = jobs.start(owner, input);
    assert.equal(jobs.get(other, job.id), null);
    assert.equal(jobs.video(owner, job.id), null);
    assert.throws(() => jobs.start(owner, input), /already rendering/);
    await tick();
    complete(Buffer.from("video"));
    await tick();
    assert.equal(jobs.get(owner, job.id).state, "ready");
    assert.equal(jobs.video(owner, job.id).toString(), "video");
  } finally {
    jobs.close();
  }
});

test("cancelled and released sessions never publish late renders", async () => {
  let complete;
  const jobs = createAnimationJobs({
    render: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  try {
    const token = jobs.issueToken();
    const job = jobs.start(token, input);
    await tick();
    jobs.cancel(token);
    complete(Buffer.from("late"));
    await tick();
    assert.equal(jobs.get(token, job.id).state, "cancelled");
    assert.equal(jobs.video(token, job.id), null);
    jobs.release(token);
    assert.equal(jobs.has(token), false);
  } finally {
    jobs.close();
  }
});

test("failures and oversized inputs are explicit", async () => {
  const jobs = createAnimationJobs({
    render: async () => {
      throw new Error("Render timed out");
    },
  });
  try {
    const token = jobs.issueToken();
    assert.throws(
      () => jobs.start(token, { ...input, code: "x".repeat(24001) }),
      /Invalid/,
    );
    const job = jobs.start(token, input);
    await tick();
    assert.equal(jobs.get(token, job.id).state, "failed");
    assert.equal(jobs.get(token, job.id).error, "Render timed out");
  } finally {
    jobs.close();
  }
});
