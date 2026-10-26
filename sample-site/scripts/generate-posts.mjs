// Writes N generated blog posts (default 100) into src/content/blog/generated/
// (gitignored). Used to measure build time, bundle size, memory and overlay
// size on a bigger site. Usage: node scripts/generate-posts.mjs [count|clean]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "src/content/blog/generated");
const arg = process.argv[2] ?? "100";

if (arg === "clean") {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("removed", path.relative(root, dir));
  process.exit(0);
}

const count = Number(arg);
const authors = ["ana-torres", "marco-rossi", "lena-fischer", "kofi-mensah"];
const tags = ["photography", "design", "crafts", "writing", "travel", "tools"];
const words =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud".split(
    " ",
  );
// deterministic pseudo-random so reruns produce the same files
let seed = 42;
const rnd = (n) => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed % n;
};
const sentence = () =>
  Array.from({ length: 8 + rnd(10) }, () => words[rnd(words.length)]).join(" ") + ".";
const paragraph = () => Array.from({ length: 4 + rnd(4) }, sentence).join(" ");

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
for (let i = 1; i <= count; i++) {
  const n = String(i).padStart(3, "0");
  const date = new Date(Date.UTC(2024, 0, 1 + i * 3)).toISOString();
  const postTags = [tags[rnd(tags.length)], tags[rnd(tags.length)]];
  const body = Array.from({ length: 5 }, (_, k) => `## Section ${k + 1}\n\n${paragraph()}\n\n${paragraph()}`).join("\n\n");
  const md = `---
title: "Generated post ${n}"
description: "Generated for scale tests."
date: ${date}
author: ${authors[rnd(authors.length)]}
tags: [${[...new Set(postTags)].join(", ")}]
draft: false
---

${body}
`;
  fs.writeFileSync(path.join(dir, `post-${n}.md`), md);
}
console.log(`wrote ${count} posts to ${path.relative(root, dir)}`);
