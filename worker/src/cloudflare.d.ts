// Minimal Cloudflare Workers type shims for local TypeScript.
// (Keeps this repo self-contained; Wrangler provides the real runtime bindings.)

declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

declare interface AiBinding {
  run(model: string, input: unknown): Promise<any>;
}
