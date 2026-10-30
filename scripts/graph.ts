// Module-graph views: `npm run graph`. Writes two files to reports/graph/:
//   modules.html  for people: Mermaid diagrams, folder level then file level.
//   deps.txt      for agents: one `from → to` line per edge, packages collapsed.
// Scope and resolve options come from .dependency-cruiser-graph.cjs. For a
// narrower question use `npm run deps -- --focus <regex>` or `--reaches <regex>`.
// DOCS/QUALITY-TOOLING.md "Module graph" explains how to read both files.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'reports/graph';
const BASE =
  'npx depcruise preview-render-server/src preview-protocol/src --config .dependency-cruiser-graph.cjs';
const INTERNAL = `-I "^(preview-render-server|preview-protocol)/src"`;
const FOLDERS = `-S "^(preview-render-server|preview-protocol)/src/[^/]+"`;
const PACKAGES = `-S "^node_modules/(@[^/]+/[^/]+|[^/]+)"`;

function cruise(args: string): string {
  const run = spawnSync(`${BASE} ${args}`, { shell: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (run.status !== 0) {
    process.stderr.write(run.stderr);
    throw new Error(`depcruise ${args} exited with ${run.status}`);
  }
  return run.stdout;
}

// A file with a type-only and a runtime import of the same module gives two
// identical edges; keep the first. Non-edge lines (nodes, subgraph ends) stay.
function dedupeEdges(text: string, arrow: string): string {
  const seen = new Set<string>();
  return text
    .split('\n')
    .filter((line) => {
      if (!line.includes(arrow)) return true;
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    })
    .join('\n');
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const folders = dedupeEdges(cruise(`-T mermaid ${INTERNAL} ${FOLDERS}`), '-->');
const files = dedupeEdges(cruise(`-T mermaid ${INTERNAL}`), '-->');
const deps = dedupeEdges(cruise(`-T text ${PACKAGES}`), '→');

const html = `<!doctype html>
<meta charset="utf-8">
<title>astroViewCMS module graph</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 2rem; }
  pre.mermaid { overflow: auto; }
</style>
<h1>Module graph</h1>
<p>Production code of preview-render-server and preview-protocol; tests and packages left out.
Generated ${new Date().toISOString().slice(0, 10)} by <code>npm run graph</code>.</p>
<h2>Folders</h2>
<pre class="mermaid">${escapeHtml(folders)}</pre>
<h2>Files</h2>
<pre class="mermaid">${escapeHtml(files)}</pre>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, maxEdges: 2000, flowchart: { useMaxWidth: false } });
</script>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/modules.html`, html);
writeFileSync(`${OUT}/deps.txt`, deps);
console.log(`Wrote ${OUT}/modules.html and ${OUT}/deps.txt (${deps.trim().split('\n').length} edges)`);
