import { assertConfig, config } from './config.js';
import { buildApp } from './app.js';

assertConfig((msg) => console.warn(`[config] ${msg}`));

const { app, projects } = await buildApp();

await app.listen({ port: config.port, host: config.host });
app.log.info(`FF-Overlay läuft auf ${config.publicUrl}`);
await projects.startAll();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} empfangen, fahre herunter …`);
    await app.close();
    process.exit(0);
  });
}
