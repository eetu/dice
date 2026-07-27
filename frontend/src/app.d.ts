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

  /** Set by the boot watchdog in `app.html` / the root layout. The watchdog is
   *  plain inline ES5 outside the build, so its contract lives here. */
  interface Window {
    /** True once the SPA has actually rendered — stops the watchdog firing. */
    __diceBooted?: boolean;
    /** Hides the watchdog's panel (a late boot beat its timeout). */
    __diceHideBootFail?: () => void;
  }
}

export {};
