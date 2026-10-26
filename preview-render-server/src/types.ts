// Site configuration: what the preview render server needs to know about one
// site (see sites/*.config.ts).

export interface IslandConfig {
  /** The component that renders the island, relative to the site root. */
  component: string;
  /** Saved content: the JSON file (relative to the site root) and the keys
   *  that become the component's props. */
  content?: { file: string; props: string[] };
  /** Folder of the JSON file the props come from. `image()` fields store
   *  paths relative to it, e.g. "../assets/images/x.png". */
  contentDir?: string;
}

export interface SiteConfig {
  /** Site folder, relative to the config file. */
  root: string;
  islands: Record<string, IslandConfig>;
  port: number;
}

/** A SiteConfig with every path made absolute. */
export interface ResolvedSiteConfig extends SiteConfig {
  outDir: string;
  islandsDir: string;
  mediaDir: string;
}
