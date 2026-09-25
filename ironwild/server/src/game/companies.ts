// Companies (§46): players pool land, factories, storage and a shared treasury.

import { formatCrests, roundCrests, type ClientMessage } from '@ironwild/shared';
import type { CompanySave } from '../persistence/storage';
import type { Game } from './game';
import type { Player } from './player';

const NAME = /^[A-Za-z0-9 '&.-]{3,28}$/;

export class CompanySystem {
  private companies = new Map<string, CompanySave>();
  /** Account id → company id. */
  private readonly memberOf = new Map<string, string>();
  private readonly invites = new Map<string, string>();
  private nextId = 1;

  constructor(private readonly game: Game) {}

  attach(p: Player): void {
    p.company = this.memberOf.get(p.accountId) ?? null;
  }

  name(id: string): string | undefined {
    return this.companies.get(id)?.name;
  }

  sameCompany(a: string, b: string): boolean {
    const ca = this.memberOf.get(a);
    return !!ca && ca === this.memberOf.get(b);
  }

  handle(p: Player, msg: Extract<ClientMessage, { t: 'company' }>): void {
    switch (msg.op) {
      case 'create':
        this.create(p, msg.name);
        break;
      case 'invite':
        this.invite(p, msg.name);
        break;
      case 'accept':
        this.accept(p);
        break;
      case 'leave':
        this.leave(p);
        break;
      case 'kick':
        this.kick(p, msg.name);
        break;
      case 'deposit':
      case 'withdraw':
        this.treasury(p, msg.op, msg.amount);
        break;
    }
  }

  private create(p: Player, name: string): void {
    if (typeof name !== 'string' || !NAME.test(name.trim())) {
      this.game.notice(p, 'Company names are 3–28 letters, numbers and spaces.', 'bad');
      return;
    }
    if (p.company) {
      this.game.notice(p, 'Leave your current company first.', 'bad');
      return;
    }
    const fee = 500;
    if (p.crests < fee) {
      this.game.notice(p, `Registering a company costs ${formatCrests(fee)}.`, 'bad');
      return;
    }
    const clean = name.trim();
    for (const c of this.companies.values())
      if (c.name.toLowerCase() === clean.toLowerCase()) return this.game.notice(p, 'That name is taken.', 'bad');
    p.crests -= fee;
    const c: CompanySave = {
      id: `co${this.nextId++}${Date.now().toString(36)}`,
      name: clean,
      owner: p.accountId,
      members: [{ id: p.accountId, name: p.name, role: 'owner' }],
      treasury: 0,
      created: Date.now(),
    };
    this.companies.set(c.id, c);
    this.memberOf.set(p.accountId, c.id);
    p.company = c.id;
    p.statusDirty = true;
    this.game.broadcastChat('', `${p.name} founded ${clean}.`, 'system');
  }

  private invite(p: Player, name: string): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    const me = c?.members.find((m) => m.id === p.accountId);
    if (!c || !me || me.role === 'member') return;
    const target = this.game.playerByName(name);
    if (!target || target.company) {
      this.game.notice(p, 'They are not online or already in a company.', 'bad');
      return;
    }
    this.invites.set(target.accountId, c.id);
    this.game.notice(target, `${p.name} invited you to ${c.name}. Type /company accept to join.`, 'good');
    this.game.notice(p, `Invited ${target.name}.`, 'info');
  }

  private accept(p: Player): void {
    const id = this.invites.get(p.accountId);
    const c = id ? this.companies.get(id) : undefined;
    if (!c || p.company) return;
    this.invites.delete(p.accountId);
    c.members.push({ id: p.accountId, name: p.name, role: 'member' });
    this.memberOf.set(p.accountId, c.id);
    p.company = c.id;
    p.statusDirty = true;
    this.chat(c, `${p.name} joined the company.`);
  }

  private leave(p: Player): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    if (!c) return;
    c.members = c.members.filter((m) => m.id !== p.accountId);
    this.memberOf.delete(p.accountId);
    p.company = null;
    p.statusDirty = true;
    if (c.members.length === 0) {
      p.crests += c.treasury;
      this.companies.delete(c.id);
      this.game.notice(p, `${c.name} was dissolved.`, 'info');
      return;
    }
    if (c.owner === p.accountId) {
      c.owner = c.members[0].id;
      c.members[0].role = 'owner';
    }
    this.chat(c, `${p.name} left the company.`);
  }

  private kick(p: Player, name: string): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    if (!c || c.owner !== p.accountId) return;
    const m = c.members.find((x) => x.name.toLowerCase() === String(name).toLowerCase() && x.id !== p.accountId);
    if (!m) return;
    c.members = c.members.filter((x) => x !== m);
    this.memberOf.delete(m.id);
    const target = this.game.byAccount.get(m.id);
    if (target) {
      target.company = null;
      target.statusDirty = true;
      this.game.notice(target, `You were removed from ${c.name}.`, 'bad');
    }
    this.chat(c, `${m.name} was removed from the company.`);
  }

  private treasury(p: Player, op: 'deposit' | 'withdraw', amount: number): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    const a = roundCrests(Number(amount));
    if (!c || !(a > 0)) return;
    if (op === 'deposit') {
      if (a > p.crests) return;
      p.crests = roundCrests(p.crests - a);
      c.treasury = roundCrests(c.treasury + a);
    } else {
      const me = c.members.find((m) => m.id === p.accountId);
      if (!me || me.role === 'member' || a > c.treasury) return;
      c.treasury = roundCrests(c.treasury - a);
      p.crests = roundCrests(p.crests + a);
    }
    p.statusDirty = true;
    this.chat(c, `${p.name} ${op === 'deposit' ? 'deposited' : 'withdrew'} ${formatCrests(a)}. Treasury: ${formatCrests(c.treasury)}.`);
  }

  info(p: Player): string {
    const c = p.company ? this.companies.get(p.company) : undefined;
    if (!c) return 'You are not in a company. /company create <name> (₡500)';
    return `${c.name} — treasury ${formatCrests(c.treasury)} — members: ${c.members.map((m) => `${m.name} (${m.role})`).join(', ')}`;
  }

  chat(c: CompanySave, text: string): void {
    for (const m of c.members) {
      const p = this.game.byAccount.get(m.id);
      if (p) p.session.send({ t: 'chat', from: c.name, text, kind: 'company' });
    }
  }

  companyChat(p: Player, text: string): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    if (!c) return;
    for (const m of c.members) {
      const other = this.game.byAccount.get(m.id);
      if (other) other.session.send({ t: 'chat', from: `[${c.name}] ${p.name}`, text, kind: 'company' });
    }
  }

  save(): CompanySave[] {
    return [...this.companies.values()];
  }

  load(list: CompanySave[]): void {
    this.companies = new Map(list.map((c) => [c.id, c]));
    for (const c of list) for (const m of c.members) this.memberOf.set(m.id, c.id);
    this.nextId = list.length + 1;
  }
}
