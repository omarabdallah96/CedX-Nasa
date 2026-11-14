/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Origin of the Firesight API, e.g. https://api.example.org. Empty means the site's own origin. */
  readonly VITE_API_URL?: string;
}
