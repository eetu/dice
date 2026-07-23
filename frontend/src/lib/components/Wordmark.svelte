<script lang="ts">
  type Props = { size?: string };
  let { size = "1.5rem" }: Props = $props();
</script>

<span class="halo-wordmark" style="font-size: {size}"
  >dice<span class="accent">.</span></span
>
