import { createNodeEngine } from './create-engine.ts';

const headless = process.env.SYNTRO_HEADED !== '1';
const node = await createNodeEngine({ headless, verbose: process.env.SYNTRO_VERBOSE === '1' });
node.engine.ensureDemoProject();
console.log(`
  Syntro engine  →  ${node.baseUrl}
  API            →  ${node.baseUrl}/v1/health
  Demo store     →  ${node.baseUrl}/sites/store/index.html
  Collector      →  ${node.baseUrl}/v1/collect
`);

const shutdown = async () => {
  await node.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
