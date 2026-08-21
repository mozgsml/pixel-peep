/// <reference types="vite/client" />

declare const __BUILD_SHA__: string;
declare const __BUILD_DATE__: string;
declare const __REPO_URL__: string;

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      cb: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void,
    ): void;
    free?(): void;
  }
  export interface HeifDecoder {
    decode(buffer: ArrayBuffer | Uint8Array): HeifImage[];
  }
  export interface LibHeif {
    HeifDecoder: new () => HeifDecoder;
  }
  const factory: (opts?: Record<string, unknown>) => LibHeif;
  export default factory;
}
