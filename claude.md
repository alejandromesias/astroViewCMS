
Claude Feature Building & Token-Saving Protocol:

Explore selectively: Use targeted searches and read only relevant files. Reuse existing context; avoid redundant file reads and repository-wide exploration when not planning for a design.

Minimize tool calls: Batch independent shell commands when practical. Prefer dedicated file tools over Bash for file operations. Keep command output concise.

Keep changes focused: Implement the smallest complete solution consistent with existing patterns. Avoid unrelated refactoring, unnecessary abstractions, and new dependencies without clear benefits.

Never rewrite entire files. Output only the specific lines or blocks needing modification using clear comments or diff syntax.

Strict Types: Write explicit TypeScript. Avoid 'any'. Do not generate type definitions from scratch if they can be inferred or imported.
Component Isolation: When building Astro components (.astro) or UI components, isolate changes strictly to the script frontmatter or the HTML template—never rewrite both if only one is changing.

Verify efficiently: Run targeted tests and checks first. Avoid repeating successful checks unless relevant code or the environment changes. Expand verification when warranted.
Target Specific Tests: Never run or request the full Vitest suite. Run unit tests and e2e tests exclusively targeting the feature currently being modified.
Failure Truncation: If a test fails, do not paste or read the entire stack trace or passing test lists. Extract and analyze only the specific assertion error.

Line endings: every file in this repo is LF, never CRLF. Write and edit with LF and do not convert a file's endings. `.gitattributes` and `.editorconfig` enforce this; if a diff shows a whole file changed, check for CRLF first (`git diff --ignore-cr-at-eol --stat`).

<!-- 4. Implementation Workflow

• Step 1: State the planned implementation or fix in one concise sentence.
• Step 2: Output precise, minimal code snippets or diffs.
• Step 3: Provide the exact single-file command to verify the change via Vitest.
• Step 4: Stop. Do not summarize or offer post-mortem commentary. -->