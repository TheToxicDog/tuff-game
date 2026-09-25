// Chat and slash commands.

import { CREATURE_BY_ID, ITEM_BY_ID, RESEARCH, formatCrests, roundCrests, stackLimit } from '@ironwild/shared';
import type { Game } from './game';
import type { Player } from './player';

const HELP = [
  '/who — players online',
  '/pay <name> <amount> — give Crests',
  '/c <text> — company chat',
  '/company create <name> | invite <name> | accept | leave | kick <name> | deposit <n> | withdraw <n> | info',
  '/stuck — return to Westhaven if you are stuck',
];

const ADMIN_HELP = [
  '/give <item> [count] [quality]',
  '/tp <x> <y> | /tp <player>',
  '/time <hour>',
  '/crests <amount>',
  '/kp <amount>',
  '/spawn <creature> [count]',
  '/research all',
  '/raid — send raiders against the nearest claim (10 s warning)',
  '/event [title] — start a market event (e.g. /event Iron shortage)',
  '/heal',
  '/save',
];

export class Commands {
  constructor(private readonly game: Game) {}

  chat(p: Player, raw: unknown): void {
    if (typeof raw !== 'string') return;
    const text = raw.trim().slice(0, 240);
    if (!text) return;
    if (text.startsWith('/')) {
      this.command(p, text.slice(1));
      return;
    }
    const now = Date.now();
    if (now - p.lastChatAt < 600) return;
    p.lastChatAt = now;
    this.game.broadcastChat(p.name, text);
  }

  private reply(p: Player, text: string): void {
    p.session.send({ t: 'chat', from: '', text, kind: 'system' });
  }

  private command(p: Player, line: string): void {
    const [cmd, ...args] = line.split(/\s+/);
    const admin = p.account.isAdmin;
    switch (cmd.toLowerCase()) {
      case 'help':
        for (const l of HELP) this.reply(p, l);
        if (admin) for (const l of ADMIN_HELP) this.reply(p, l);
        return;
      case 'who':
        this.reply(p, `${this.game.players.size} online: ${[...this.game.players.values()].map((x) => x.name).join(', ')}`);
        return;
      case 'pay': {
        const target = this.game.playerByName(args[0] ?? '');
        const amount = roundCrests(Number(args[1]));
        if (!target || target === p || !(amount > 0) || amount > p.crests) {
          this.reply(p, 'Usage: /pay <name> <amount> (they must be online).');
          return;
        }
        p.crests = roundCrests(p.crests - amount);
        target.crests = roundCrests(target.crests + amount);
        p.statusDirty = target.statusDirty = true;
        this.game.notice(target, `${p.name} paid you ${formatCrests(amount)}.`, 'money');
        this.reply(p, `Paid ${target.name} ${formatCrests(amount)}.`);
        return;
      }
      case 'c':
        this.game.companies.companyChat(p, args.join(' '));
        return;
      case 'company': {
        const op = (args[0] ?? 'info').toLowerCase();
        const rest = args.slice(1).join(' ');
        if (op === 'info') this.reply(p, this.game.companies.info(p));
        else if (op === 'create') this.game.companies.handle(p, { t: 'company', op: 'create', name: rest });
        else if (op === 'invite' || op === 'kick') this.game.companies.handle(p, { t: 'company', op, name: rest });
        else if (op === 'accept' || op === 'leave') this.game.companies.handle(p, { t: 'company', op });
        else if (op === 'deposit' || op === 'withdraw') this.game.companies.handle(p, { t: 'company', op, amount: Number(rest) });
        return;
      }
      case 'stuck': {
        const s = this.game.world.gen.spawn;
        if (p.move.x === s.x && p.move.y === s.y) return;
        p.move.x = s.x;
        p.move.y = s.y;
        this.reply(p, 'You find your way back to Westhaven.');
        return;
      }
    }
    if (!admin) {
      this.reply(p, 'Unknown command. Try /help.');
      return;
    }
    switch (cmd.toLowerCase()) {
      case 'give': {
        const def = ITEM_BY_ID.get(args[0] ?? '');
        if (!def) {
          this.reply(p, 'Unknown item.');
          return;
        }
        const n = Math.max(1, Math.min(stackLimit(def.id) * 10, Number(args[1] ?? 1) || 1));
        const q = args[2] !== undefined ? Number(args[2]) : undefined;
        this.game.playerSystem.give(p, { id: def.id, n, ...(def.quality ? { q: q ?? 1 } : {}) });
        return;
      }
      case 'tp': {
        if (args.length >= 2) {
          p.move.x = Number(args[0]) || p.move.x;
          p.move.y = Number(args[1]) || p.move.y;
        } else {
          const t = this.game.playerByName(args[0] ?? '');
          if (t) {
            p.move.x = t.x + 1;
            p.move.y = t.y;
          }
        }
        return;
      }
      case 'time': {
        const h = Number(args[0]);
        if (!Number.isFinite(h)) return;
        const day = Math.floor(this.game.minutes / 1440);
        this.game.minutes = day * 1440 + (((h % 24) + 24) % 24) * 60;
        return;
      }
      case 'crests':
        p.crests = roundCrests(p.crests + (Number(args[0]) || 0));
        p.statusDirty = true;
        return;
      case 'kp':
        this.game.progression.addKnowledge(p, Number(args[0]) || 0);
        return;
      case 'spawn': {
        const def = CREATURE_BY_ID.get(args[0] ?? '');
        if (!def) return;
        const n = Math.min(20, Number(args[1] ?? 1) || 1);
        for (let i = 0; i < n; i++) this.game.creatures.spawn(def.id, p.x + Math.cos(p.angle) * 4, p.y + Math.sin(p.angle) * 4, '');
        return;
      }
      case 'raid': {
        let best = null;
        let bestD = Infinity;
        for (const c of this.game.world.claims) {
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (!best) this.reply(p, 'There are no claims.');
        else if (!this.game.raids.start(best, 10_000)) this.reply(p, 'The bandits found nowhere to gather.');
        else this.reply(p, `Raid on ${best.ownerName}'s claim (worth ₡${this.game.raids.wealth(best)}).`);
        return;
      }
      case 'event': {
        const e = this.game.economy.startEvent(args.join(' ') || undefined);
        if (!e) this.reply(p, 'No such event, or every town already has one.');
        return;
      }
      case 'research':
        for (const r of RESEARCH) p.unlocked.add(r.id);
        p.researchDirty = true;
        return;
      case 'heal':
        p.hp = 100;
        p.hunger = 100;
        p.statusDirty = true;
        return;
      case 'save':
        void this.game.save().then(() => this.reply(p, 'Saved.'));
        return;
      default:
        this.reply(p, 'Unknown command. Try /help.');
    }
  }
}
