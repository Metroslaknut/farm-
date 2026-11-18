/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public API origin. Empty = same origin via the dev proxy. */
  readonly VITE_API_BASE_URL?: string;
  /** `true` exposes the internal /design-system preview outside development. */
  readonly VITE_ENABLE_DESIGN_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
