import type { HandleClientError } from "@sveltejs/kit";

import { report } from "$lib/report";

// SvelteKit's default client `handleError` throws the real message away and
// hands the error page a bare "Internal Error" — which is how a client-side
// failure turns into an unactionable bug report. Keep the message (it's rendered
// by +error.svelte for the user to relay) and report it.
export const handleError: HandleClientError = ({ error, message, status }) => {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : message;
  // 404s are just a mistyped URL, not a fault worth reporting.
  if (status !== 404) report("route", detail);
  return { message: detail };
};
