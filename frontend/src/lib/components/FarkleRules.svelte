<script lang="ts">
  // The Farkle scoring cheat sheet, shown by flipping the board (the `?` button).
  // Two columns, drawn with real dice glyphs — singles + three-of-a-kind on the
  // left, the bigger combos on the right — mirroring room::farkle_* (the backend
  // is the authority; this is just the human-readable reference). A "?" die means
  // "any face, as long as they match".
  import { i18n } from "$lib/i18n/i18n.svelte";

  type Props = { target: number };
  let { target }: Props = $props();

  // 3×3 pip layout per face (same as the board's dice). "?" renders a query glyph.
  type Face = number | "?";
  const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const PIPS: Record<number, number[]> = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };

  // Left column: singles, then three-of-a-kind (1s = 1000, else face×100 — matches
  // farkle_per_face). Each row is dice glyphs + points on one line.
  const SINGLES: { dice: Face[]; pts: string }[] = [
    { dice: [1], pts: "100" },
    { dice: [5], pts: "50" },
  ];
  const TRIPLES: { dice: Face[]; pts: string }[] = [1, 2, 3, 4, 5, 6].map(
    (f) => ({ dice: [f, f, f], pts: f === 1 ? "1000" : `${f * 100}` }),
  );

  // Right column: bigger combos. `groups` are drawn with a wider gap between them
  // (so pairs / triplets read as groups). Four/five/six of a kind multiply the
  // three-of-a-kind score (×2 / ×4 / ×8), so the value is a multiplier.
  const COMBOS: { key: string; groups: Face[][]; pts: string }[] = [
    { key: "fourKind", groups: [["?", "?", "?", "?"]], pts: "×2" },
    { key: "fiveKind", groups: [["?", "?", "?", "?", "?"]], pts: "×4" },
    { key: "sixKind", groups: [["?", "?", "?", "?", "?", "?"]], pts: "×8" },
    { key: "straight", groups: [[1, 2, 3, 4, 5, 6]], pts: "1500" },
    {
      key: "threePairs",
      groups: [
        ["?", "?"],
        ["?", "?"],
        ["?", "?"],
      ],
      pts: "1500",
    },
    {
      key: "twoTriplets",
      groups: [
        ["?", "?", "?"],
        ["?", "?", "?"],
      ],
      pts: "2500",
    },
  ];
  const NAME = i18n.m.farkleRuleName as Record<string, string>;
</script>

{#snippet die(f: Face)}
  <span class="rdie" class:q={f === "?"}>
    {#if f === "?"}
      <span class="qm">?</span>
    {:else}
      {#each CELLS as c (c)}
        <span class="rpip" class:on={PIPS[f].includes(c)}></span>
      {/each}
    {/if}
  </span>
{/snippet}

<div class="rules">
  <h3>{i18n.m.farkleRulesScoring}</h3>

  <div class="cols">
    <!-- Left: singles + three-of-a-kind (dice + points inline). -->
    <div class="col">
      {#each SINGLES as r (r.pts)}
        <div class="line">
          <span class="glyphs"
            >{#each r.dice as f, i (i)}{@render die(f)}{/each}</span
          >
          <span class="pts">{r.pts}</span>
        </div>
      {/each}
      <h4>{i18n.m.farkleRulesThreeKind}</h4>
      {#each TRIPLES as r (r.pts)}
        <div class="line">
          <span class="glyphs"
            >{#each r.dice as f, i (i)}{@render die(f)}{/each}</span
          >
          <span class="pts">{r.pts}</span>
        </div>
      {/each}
    </div>

    <!-- Right: bigger combos (label + points on top, dice row below). -->
    <div class="col">
      {#each COMBOS as c (c.key)}
        <div class="combo">
          <div class="chead">
            <span class="scap">{NAME[c.key]}</span>
            <span class="pts">{c.pts}</span>
          </div>
          <div class="glyphs groups">
            {#each c.groups as g, gi (gi)}
              <span class="grp"
                >{#each g as f, i (i)}{@render die(f)}{/each}</span
              >
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <p class="note">{i18n.m.farkleRuleLadder}</p>
  <p class="note">{i18n.m.farkleHint}</p>
  <p class="note goal">{i18n.m.farkleTarget(target)}</p>
</div>

<style>
  .rules {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    color: var(--halo-text-main);
  }
  h3 {
    margin: 0;
    font-size: 1rem;
    font-family: var(--halo-font-heading);
  }
  h4 {
    margin: 0.25rem 0 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--halo-text-muted);
  }

  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 0.9rem;
    align-items: start;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-width: 0;
  }

  /* Left column: dice + points on one line, points right-aligned. */
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  /* Right column: label + points header, then a dice row below. */
  .combo {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .chead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.4rem;
  }
  .scap {
    font-size: 0.85rem;
    color: var(--halo-text-muted);
  }

  .glyphs {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    flex-wrap: wrap;
  }
  /* A wider gap between groups (pairs / triplets read as clusters). */
  .glyphs.groups {
    gap: 0.55rem;
  }
  .grp {
    display: inline-flex;
    gap: 0.2rem;
  }
  .pts {
    justify-self: end;
    font-family: var(--halo-font-heading);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--halo-accent);
    white-space: nowrap;
  }
  .note {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--halo-text-muted);
  }
  .note.goal {
    font-weight: 600;
    color: var(--halo-text-main);
  }

  /* Die glyph (3×3 pips) — bigger than the inline reference used to be. */
  .rdie {
    display: inline-grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0.18rem;
    background: var(--halo-bg-light);
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px var(--halo-border);
    box-sizing: border-box;
    vertical-align: middle;
    flex: none;
  }
  .rpip {
    border-radius: 50%;
  }
  .rpip.on {
    background: var(--halo-text-main);
    align-self: center;
    justify-self: center;
    width: 0.24rem;
    height: 0.24rem;
  }
  /* "?" die — any matching face. */
  .rdie.q {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--halo-text-muted);
    font-family: var(--halo-font-heading);
    font-weight: 700;
    font-size: 1rem;
    line-height: 1;
  }
</style>
