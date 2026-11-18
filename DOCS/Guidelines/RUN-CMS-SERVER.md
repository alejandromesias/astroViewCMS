# Run cms-server against a GitHub repo

How to start `cms-server` on a site repo, from the config to the first save and publish. Written with WORKPLAN 2.11d; 2.13b grows it into the quick start. Each statement is checked against `cms-server/src/config/schema.ts`, `run.ts`, `log.ts`, `git/exec.ts` and `sync/build-check.ts`.

## 1. Prepare

- Node 26 (`.node-version`), then `npm ci` at the repo root.
- Create `cms.config.ts` at the repo root (gitignored). Start from `cms.config.example.ts`.

## 2. The config (`cms.config.ts`)

The file's default export is the config. Unknown keys are an error, so a typo fails at start.

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `site` | yes | | Lower-case letters, digits and hyphens. It names the folder `.cms/<site>/`. |
| `remote` | yes | | The repo URL, for example `https://github.com/OWNER/REPO.git` or `git@github.com:OWNER/REPO.git`. |
| `branch` | no | `main` | The branch the CMS reads from and publishes to (`origin/<branch>`). |
| `siteDir` | no | `.` | The site's folder inside the repo. A relative path. |
| `previewSiteConfig` | yes | | The preview's site config, relative to the config file's folder (for example `preview-render-server/sites/sample-site.config.ts`). |
| `origins.cms`, `origins.preview` | yes | | Each an `http` or `https` origin with an explicit port (for example `http://cms.localhost:4400` and `http://preview.localhost:4401`). They must differ, and should use two host names: cookies ignore the port, so one host shares them (start-up warns). |
| `publish.buildCheck` | no | `auto` | `always`, `auto` or `never`. See section 5. |
| `media.folder` | no | `src/assets/uploads` | Where uploaded images go, inside the site. |
| `syncIntervalSeconds` | no | `60` | Seconds between syncs with the remote, while an editor session is open (a session lasts five minutes). At most 299. |
| `collections` | no | `{}` | Per collection: `{ newEntryFormat?: "json" \| "md" \| "mdx" \| "yaml" }`. |
| `git.author` | no | `astroViewCMS <cms@localhost>` | The commit identity, in the form `Name <email>`. |

## 3. Git access

The server runs git without prompts (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, an empty `GIT_ASKPASS`). Sign-in must already work on the machine:

- **HTTPS:** the credential helper (for example Git Credential Manager) must already hold a token for the remote. Check first with `git ls-remote <remote>`. If it asks for a password, fix the helper before you start.
- **SSH:** the key must be loaded in the SSH agent with no passphrase prompt. The server uses `ssh -o BatchMode=yes`, unless `GIT_SSH_COMMAND` is set in the environment. Check with `ssh -T git@github.com` (or your host).

The account must be able to push to the branch. For a GitHub remote, a failed sign-in is reported as: `Git could not sign in to <remote>. Check the machine's git credential helper or SSH key.`

## 4. Start

- From the repo root: `npm start -w cms-server`. The start script runs `node src/main.ts ../cms.config.ts` in `cms-server`.
- Or from `cms-server`: `npm start`.
- Another config file: `node src/main.ts <path-to-config>` in `cms-server`. Do not add `-- ../cms.config.ts` to `npm start`: the config would be given twice, and the start refuses the second argument.
- `--bundle <folder>` serves a bundle that is already built. The builder is then off, and no build follows a save or publish.

Open the editor at exactly `origins.cms` (for example `http://cms.localhost:4400/`). Writes carry the page's `Origin`, and the server refuses one that is not `origins.cms` (2.14e), so the editor opened on `127.0.0.1` or `localhost` can read but not save. Add `?page=/some/path` to choose the page the preview shows.

Secrets: `PREVIEW_TOKEN_SECRET` and `PREVIEW_INTERNAL_SECRET` (64 hex digits each) come from the environment when set. Otherwise they are created once in `.cms/<site>/secrets.json`, so a restart keeps the sessions.

No GitHub account yet? `npm run dev:remote -w cms-server` makes a local bare remote and writes `cms.config.ts` for it. Then start as above.

## 5. `publish.buildCheck`

Before a publish pushes, it may build the candidate commit.

- `always`: builds every time.
- `never`: never builds before the push.
- `auto` (default): builds when the changeset needs it: an MDX body changed, a build-time field changed, a schema refinement threw, or code changed upstream. A changeset the check cannot judge (a failed sync, a broken file, a document that cannot be read) also builds. Otherwise nothing is built.

## 6. Logs and state

- **Log:** one JSON line per event. `info` goes to stdout, `warn` and `error` to stderr. There is no log file: redirect the output if you want one (for example `npm start > cms.log 2>&1`).
- **Build logs:** `.cms/<site>/logs/<bundleId>.log`, one per build.
- **`.cms/<site>/`:** in the folder of `cms.config.ts` (the repo root), gitignored.
  - `repo/`: the clone. Saves are commits on the `cms/work` branch here, not yet published.
  - `worktrees/`: the build worktrees.
  - `bundles/<bundleId>/`: the built sites. `state.json` names the one served.
  - `staging/`: uploaded images, until a save moves them into the site.
  - `media.json`: the image metadata cache.
  - `secrets.json`: the preview secrets, when they are not in the environment.

Deleting `.cms/<site>/` also deletes the unpublished saves on `cms/work`. Publish or copy them first.
