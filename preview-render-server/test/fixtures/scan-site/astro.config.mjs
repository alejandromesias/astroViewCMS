import { defineConfig } from 'astro/config';
import config from './src/config/config.json';

export default defineConfig({ site: config.site.base_url });
