<script lang="ts">
  // An accessible on/off thumb switch (role="switch").
  type Props = { checked: boolean; label: string; onChange: () => void };
  let { checked, label, onChange }: Props = $props();
</script>

<button
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="switch"
  class:on={checked}
  onclick={onChange}
>
  <span class="knob"></span>
</button>

<style>
  .switch {
    flex: none;
    width: 2.7rem;
    height: 1.55rem;
    padding: 0;
    border: none;
    border-radius: 1rem;
    background: var(--halo-off-bg);
    position: relative;
    cursor: pointer;
    transition: background var(--halo-d-fast);
  }
  .switch.on {
    background: var(--halo-accent);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc(1.55rem - 6px);
    height: calc(1.55rem - 6px);
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    transition: transform var(--halo-d-fast);
  }
  .switch.on .knob {
    transform: translateX(calc(2.7rem - 1.55rem));
  }
</style>
