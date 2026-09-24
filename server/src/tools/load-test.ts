// Load test (design plan §75: the server must hold 10 players plus zombies at 20 Hz).
//
//   npm run load-test                          10 bots against an in-process server for 30 s
//   npm run load-test -- --bots 20 --seconds 60
//   npm run load-test -- --url http://host:7777  against a running server (accounts loadbot_N must
//                                                 exist or registration must not be rate limited)
//
// Bots wander around the town, sprint, aim and shoot, so zombies wake up, investigate and chase.
// Reports snapshot rate and bandwidth per client and the server's tick time.

import { Buttons } from '@tuff/shared';
import { startServer, type RunningServer } from '../bootstrap';
import { loadContent } from '../content/loader';
import { MemoryStorage } from '../persistence/memory-storage';
import { Bot, sleep } from '../testing/bot';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function account(base: string, name: string): Promise<string> {
  try {
    return await Bot.register(base, name, 'load-test-password');
  } catch {
    return Bot.login(base, name, 'load-test-password');
  }
}

async function main(): Promise<void> {
  const count = Math.max(1, Number(arg('bots', '10')));
  const seconds = Math.max(5, Number(arg('seconds', '30')));
  const url = arg('url', '');
  let server: RunningServer | null = null;
  let base = url;
  if (!url) {
    const content = loadContent();
    content.config.maxPlayers = Math.max(content.config.maxPlayers, count);
    // Give every bot a pistol so the zombies get stirred up.
    content.config.player.startingItems = [
      { item: 'pistol_9mm', qty: 1, slot: 1 },
      { item: 'ammo_9mm', qty: 60 },
    ];
    server = await startServer({
      port: 0,
      host: '127.0.0.1',
      storage: new MemoryStorage(),
      content,
      quiet: true,
      rateLimit: false,
      autosaveSeconds: 10,
    });
    base = `http://127.0.0.1:${server.port}`;
    console.log(`In-process server on ${base}`);
  }

  const bots: Bot[] = [];
  for (let i = 0; i < count; i++) {
    const name = `loadbot_${i + 1}`;
    bots.push(await Bot.connect(base, name, await account(base, name)));
  }
  console.log(`${bots.length} bots connected; running for ${seconds} s…`);

  const start = Date.now();
  const startBytes = bots.map((b) => b.bytesIn);
  const startSnaps = bots.map((b) => b.snapshots);
  let maxTick = 0;
  let tickSum = 0;
  let tickSamples = 0;
  const brains = bots.map((_, i) => ({ dir: (i / bots.length) * Math.PI * 2, change: 0 }));
  await Promise.all([
    ...bots.map(async (bot, i) => {
      const brain = brains[i];
      while (Date.now() - start < seconds * 1000) {
        brain.change -= 0.25;
        if (brain.change <= 0) {
          brain.dir += (Math.random() - 0.5) * 2.2;
          brain.change = 1 + Math.random() * 3;
        }
        const shooting = Math.random() < 0.08;
        await bot.act(0.25, {
          moveX: Math.cos(brain.dir),
          moveY: Math.sin(brain.dir),
          aim: brain.dir + (Math.random() - 0.5),
          slot: 1,
          buttons:
            (Math.random() < 0.3 ? Buttons.Sprint : 0) |
            (shooting ? Buttons.Attack | Buttons.Aim : 0) |
            (Math.random() < 0.02 ? Buttons.Reload : 0),
        });
        // Keep memory flat on long runs.
        bot.events.length = 0;
        bot.messages.length = 0;
      }
    }),
    (async () => {
      while (Date.now() - start < seconds * 1000) {
        await sleep(1000);
        let tick = 0;
        if (server) tick = server.game.stats.tickMs;
        else {
          const r = (await (await fetch(`${base}/healthz`)).json()) as { tickMs: number };
          tick = r.tickMs;
        }
        tickSum += tick;
        tickSamples++;
        maxTick = Math.max(maxTick, server ? server.game.stats.maxTickMs : tick);
      }
    })(),
  ]);

  const elapsed = (Date.now() - start) / 1000;
  const kbps = bots.map((b, i) => (b.bytesIn - startBytes[i]) / elapsed / 1024);
  const hz = bots.map((b, i) => (b.snapshots - startSnaps[i]) / elapsed);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const summary = server?.game.summary();
  console.log('');
  console.log(`Bots:             ${bots.length}`);
  console.log(`Snapshots/s:      ${avg(hz).toFixed(1)} per client (min ${Math.min(...hz).toFixed(1)})`);
  console.log(`Downstream:       ${avg(kbps).toFixed(1)} KB/s per client (max ${Math.max(...kbps).toFixed(1)})`);
  console.log(
    `Server tick:      ${(tickSum / Math.max(1, tickSamples)).toFixed(2)} ms average, ${maxTick.toFixed(2)} ms peak (budget 50 ms)`,
  );
  if (summary)
    console.log(`World:            ${summary.zombies} active zombies, ${summary.dormant} dormant, ${summary.activeChunks} active chunks`);
  for (const b of bots) b.close();
  await server?.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
