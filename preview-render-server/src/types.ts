// Site configuration: what the preview render server needs to know about one
// site (see sites/*.config.ts).

export interface IslandConfig {
  /** The component that renders the island, relative to the site root. */
  component: string;
  /** Folder that the props' relative image paths ("../assets/images/x.png")
   *  resolve against. Temporary: only POST /__preview/<island> uses it, and
   *  it goes away with that route (WORKPLAN task 1.5). */
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
