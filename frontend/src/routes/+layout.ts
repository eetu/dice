// Pure SPA: no SSR, no prerender. Everything runs client-side (localStorage,
// WebSocket, WebGL, device sensors) so there's nothing to render on a server.
export const ssr = false;
export const prerender = false;
