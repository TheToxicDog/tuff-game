// Load test: N bots join an in-process server, wander around swinging tools, and we report tick
// time and bandwidth. `npm run ironwild:load-test -- --bots 20 --seconds 20`

import { InputFlags } from '@ironwild/shared';
import { startServer } from '../bootstrap';
import { MemoryStorage } from '../persistence/memory-storage';
import { Bot } from '../testing/bot';

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const botCount = arg('bots', 20);
const seconds = arg('seconds', 20);

async function main(): Promise<void> {
  const server = await startServer({ port: 0, storage: new MemoryStorage(), quiet: true, rateLimit: false });
  const base = `http://127.0.0.1:${server.port}`;
  const bots: Bot[] = [];
  for (let i = 0; i < botCount; i++) bots.push(await Bot.connect(base, `bot${i}`, await Bot.register(base, `bot${i}`)));
  console.log(`${bots.length} bots connected`);
  const start = Date.now();
  let worst = 0;
  const samples: number[] = [];
  const timer = setInterval(() => {
    for (const [i, b] of bots.entries()) {
      const t = (Date.now() - start) / 1000;
      const angle = t * 0.7 + i;
      b.input(InputFlags.Primary | (i % 3 === 0 ? InputFlags.Sprint : 0), Math.round(Math.cos(angle)), Math.round(Math.sin(angle)), angle);
    }
    const ms = server.game.tickMs;
    samples.push(ms);
    worst = Math.max(worst, ms);
  }, 1000 / 30);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(timer);
  const bytes = bots.reduce((n, b) => n + b.bytesIn, 0);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`tick time: avg ${avg.toFixed(2)} ms, worst ${worst.toFixed(2)} ms (budget 50 ms)`);
  console.log(`bandwidth: ${(((bytes / bots.length / seconds) * 8) / 1000).toFixed(1)} kbit/s per client (uncompressed JSON)`);
  console.log(`entities: ${server.game.entities.size}, structures: ${server.game.world.structures.size}`);
  for (const b of bots) b.close();
  await server.close();
  process.exit(avg < 50 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
