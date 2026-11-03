// The config of a local run of cms-server (WORKPLAN 2.1i). Copy it to cms.config.ts at the repo root,
// which is gitignored, and set `remote` to the site's repo. `npm run dev:remote -w cms-server` does this
// with a local bare repo instead of GitHub. Paths are relative to this file's folder (the repo root).
export default {
  site: 'sample-site',
  remote: 'https://github.com/OWNER/REPO.git',
  previewSiteConfig: 'preview-render-server/sites/sample-site.config.ts',
  origins: {
    cms: 'http://127.0.0.1:4400',
    preview: 'http://127.0.0.1:4401',
  },
};
