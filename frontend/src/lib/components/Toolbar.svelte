<script lang="ts">
  // The primary action bar: just the roll button (dice count + materials moved to
  // the Settings dialog so the felt stays the focus).
  type Props = {
    isMyTurn: boolean;
    currentName: string | null;
    currentOffline: boolean;
    rolling: boolean;
    onRoll: () => void;
    onSkip: () => void;
  };
  let {
    isMyTurn,
    currentName,
    currentOffline,
    rolling,
    onRoll,
    onSkip,
  }: Props = $props();
</script>

{#if isMyTurn}
  <button class="roll" onclick={onRoll} disabled={rolling}>
    {rolling ? "Rolling…" : "Roll"}
  </button>
{:else if currentOffline}
  <!-- Wait for a dropped player (phone standby etc.); skip is a manual fallback
    for someone who's genuinely gone. -->
  <div class="waitrow">
    <span class="waiting">Waiting for {currentName ?? "player"}…</span>
    <button class="skip" onclick={onSkip}>Skip</button>
  </div>
{:else}
  <button class="roll" disabled>
    {currentName ? `${currentName}'s turn` : "Waiting…"}
  </button>
{/if}

<style>
  .roll {
    width: 100%;
    background: var(--halo-accent);
    color: #fff;
    border: none;
    border-radius: var(--halo-radius);
    padding: 0.9em 1.5em;
    font-size: 1.1rem;
    font-weight: 600;
    transition: filter var(--halo-d-fast);
  }
  .roll:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .roll:disabled {
    background: var(--halo-off-bg);
    color: var(--halo-text-muted);
    cursor: default;
  }
  .waitrow {
    display: flex;
    align-items: stretch;
    gap: 0.6rem;
  }
  .waiting {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--halo-off-bg);
    color: var(--halo-text-muted);
    border-radius: var(--halo-radius);
    padding: 0.9em 1.5em;
    font-size: 1.1rem;
    font-weight: 600;
  }
  .skip {
    background: none;
    border: 1px solid var(--halo-border);
    color: var(--halo-text-muted);
    border-radius: var(--halo-radius);
    padding: 0 1.2em;
    font-weight: 600;
  }
  .skip:hover {
    color: var(--halo-accent);
    border-color: var(--halo-accent);
  }
</style>
