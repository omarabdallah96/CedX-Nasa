/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Origin of the Ember Almanac API, e.g. https://api.example.org. Empty means the site's own origin. */
  readonly VITE_API_URL?: string;
}
