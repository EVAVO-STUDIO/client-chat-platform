// Minimal Cloudflare Workers type shims for local TypeScript.
// (Keeps this repo self-contained; Wrangler provides the real runtime bindings.)

declare type KVNamespacePutValue =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream;

declare interface KVNamespacePutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: unknown;
}

declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: KVNamespacePutValue,
    options?: KVNamespacePutOptions,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

declare interface AiBinding {
  run(model: string, input: unknown): Promise<any>;
}
