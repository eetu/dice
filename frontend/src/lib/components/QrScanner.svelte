<script lang="ts">
  // Live camera QR scanner (for joining from within the installed PWA — iOS can't
  // route a scanned https QR into a home-screen web app, so we let the app scan).
  // Draws each video frame to an offscreen canvas and decodes with jsQR; on a
  // valid dice join code it fires onCode once. Camera is released on unmount.
  import jsQR from "jsqr";

  import { i18n } from "$lib/i18n/i18n.svelte";

  type Props = { onCode: (code: string) => void };
  let { onCode }: Props = $props();

  let video = $state<HTMLVideoElement>();
  let canvas = $state<HTMLCanvasElement>();
  let error = $state<"" | "denied" | "nocam">("");
  let bad = $state(false); // flashed when a non-dice QR is decoded
  let stream: MediaStream | null = null;
  let raf = 0;
  let last = ""; // de-dupe repeated decodes of the same frame
  let badTimer: ReturnType<typeof setTimeout> | undefined;

  // Accept a full join URL (…/g/CODE) or a bare 5-char code; returns the
  // normalised code or null. Mirrors the codes the SharePanel QR encodes.
  function codeFrom(text: string): string | null {
    const t = text.trim();
    const m = t.match(/\/g\/([A-Za-z0-9]{5})(?:[/?#]|$)/);
    if (m) return m[1].toUpperCase();
    return /^[A-Za-z0-9]{5}$/.test(t) ? t.toUpperCase() : null;
  }

  $effect(() => {
    void start();
    return stop;
  });

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      error = "nocam";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
    } catch (e) {
      error =
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "denied"
          : "nocam";
      return;
    }
    if (!video) return; // unmounted while awaiting permission
    video.srcObject = stream;
    await video.play().catch(() => {});
    raf = requestAnimationFrame(scan);
  }

  function scan() {
    raf = requestAnimationFrame(scan);
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const res = jsQR(data, w, h, { inversionAttempts: "dontInvert" });
    if (!res?.data || res.data === last) return;
    last = res.data;
    const code = codeFrom(res.data);
    if (code) {
      stop();
      onCode(code);
    } else {
      bad = true;
      clearTimeout(badTimer);
      badTimer = setTimeout(() => (bad = false), 1600);
    }
  }

  function stop() {
    cancelAnimationFrame(raf);
    clearTimeout(badTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
</script>

<div class="scanner">
  {#if error}
    <p class="err">
      {error === "denied" ? i18n.m.scanDenied : i18n.m.scanNoCam}
    </p>
  {:else}
    <div class="viewport">
      <video bind:this={video} playsinline muted></video>
      <div class="reticle" aria-hidden="true"></div>
    </div>
    <p class="hint" class:bad>{bad ? i18n.m.scanInvalid : i18n.m.scanHint}</p>
  {/if}
  <canvas bind:this={canvas} class="offscreen"></canvas>
</div>

<style>
  .scanner {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }
  .viewport {
    position: relative;
    width: 100%;
    max-width: 22rem;
    aspect-ratio: 1;
    border-radius: var(--halo-radius);
    overflow: hidden;
    background: #000;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  /* A framing square to aim the code into. */
  .reticle {
    position: absolute;
    inset: 12%;
    border: 3px solid var(--halo-accent);
    border-radius: var(--halo-radius);
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35);
  }
  .hint {
    margin: 0;
    text-align: center;
    color: var(--halo-text-muted);
    font-size: 0.9rem;
  }
  .hint.bad {
    color: var(--halo-error);
  }
  .err {
    margin: 2rem 0;
    text-align: center;
    color: var(--halo-text-muted);
  }
  .offscreen {
    display: none;
  }
</style>
