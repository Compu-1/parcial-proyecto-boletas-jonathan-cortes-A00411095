/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ICE_HOST?: string;
  readonly VITE_ICE_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
