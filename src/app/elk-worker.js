let engine;

self.onmessage = handleLayout;

async function handleLayout({ data: { request, family, mode } }) {
  try {
    if (!engine) {
      importScripts('https://cdn.jsdelivr.net/npm/elkjs@0.12.1/lib/elk.bundled.js');
      engine = new self.ELK();
      // The ELK bundle also registers a standalone worker handler.
      self.onmessage = handleLayout;
    }
    const { buildElkLayout } = await import('./elk-layout.js');
    self.postMessage({ request, started: true });
    const layout = await buildElkLayout(family, engine, mode);
    self.postMessage({ request, layout });
  } catch (error) {
    self.postMessage({ request, error: error?.message || String(error) });
  }
}
