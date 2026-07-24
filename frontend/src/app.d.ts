// See https://svelte.dev/docs/kit/types#app
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }

  /** App version baked in at build time (vite define ← package.json). */
  const __APP_VERSION__: string;
}

export {};
