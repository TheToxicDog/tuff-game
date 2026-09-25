// Companies (§46): players pool land, factories, storage and a shared treasury. A company is also
// an owner: land claims (and everything on them) can be handed to it, after which every member
// can use them, officers manage them, and what its shop stands and shipping crates earn goes to
// the treasury.

import {
  ITEM_BY_ID,
  STRUCTURE_BY_ID,
  formatCrests,
  roundCrests,
  type ClientMessage,
  type CompanyInfo,
  type CompanyRole,
} from '@ironwild/shared';
import type { CompanySave } from '../persistence/storage';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

const NAME = /^[A-Za-z0-9 '&.-]{3,28}$/;
const FOUNDING_FEE = 500;
/** Owner ids of company property. */
const PREFIX = 'co:';
/** Game minutes of ledger kept. */
const LEDGER_MINUTES = 2 * 1440;

export const companyAccount = (id: string): string => `${PREFIX}${id}`;
export const isCompanyAccount = (owner: string | null | undefined): owner is string => !!owner && owner.startsWith(PREFIX);

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

  /** The company behind an account or company owner id. */
  private companyOf(owner: string): string | undefined {
    return isCompanyAccount(owner) ? owner.slice(PREFIX.length) : this.memberOf.get(owner);
  }

  /** Whether two owners (accounts or companies) belong to the same company. */
  sameCompany(a: string, b: string): boolean {
    const ca = this.companyOf(a);
    return !!ca && ca === this.companyOf(b);
  }

  /** A player's role in the company that owns something, if any. */
  roleFor(accountId: string, owner: string): CompanyRole | null {
    const id = this.companyOf(owner);
    if (!id || this.memberOf.get(accountId) !== id) return null;
    return this.companies.get(id)?.members.find((m) => m.id === accountId)?.role ?? null;
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
      case 'decline':
        this.invites.delete(p.accountId);
        break;
      case 'leave':
        this.leave(p);
        break;
      case 'kick':
        this.kick(p, msg.name);
        break;
      case 'promote':
      case 'demote':
        this.setRole(p, msg.name, msg.op === 'promote' ? 'officer' : 'member');
        break;
      case 'deposit':
      case 'withdraw':
        this.treasury(p, msg.op, msg.amount);
        break;
      case 'transfer':
        this.transfer(p, msg.claim);
        break;
      case 'info':
        break;
    }
    this.sendInfo(p);
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
    if (p.crests < FOUNDING_FEE) {
      this.game.notice(p, `Registering a company costs ${formatCrests(FOUNDING_FEE)}.`, 'bad');
      return;
    }
    const clean = name.trim();
    for (const c of this.companies.values())
      if (c.name.toLowerCase() === clean.toLowerCase()) return this.game.notice(p, 'That name is taken.', 'bad');
    p.crests -= FOUNDING_FEE;
    const c: CompanySave = {
      id: `co${this.nextId++}${Date.now().toString(36)}`,
      name: clean,
      owner: p.accountId,
      members: [{ id: p.accountId, name: p.name, role: 'owner' }],
      treasury: 0,
      created: Date.now(),
      ledger: [],
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
    this.game.notice(target, `${p.name} invited you to ${c.name}. Open your company (C) or type /company accept.`, 'good');
    this.game.notice(p, `Invited ${target.name}.`, 'info');
    this.sendInfo(target);
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
    this.sendAll(c);
  }

  private leave(p: Player): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    if (!c) return;
    c.members = c.members.filter((m) => m.id !== p.accountId);
    this.memberOf.delete(p.accountId);
    p.company = null;
    p.statusDirty = true;
    if (c.members.length === 0) {
      // The last one out takes the treasury and the property.
      p.crests = roundCrests(p.crests + c.treasury);
      const n = this.reassign(companyAccount(c.id), p.accountId, p.name);
      this.companies.delete(c.id);
      this.game.notice(p, `${c.name} was dissolved.${n ? ` Its ${n} structures are yours again.` : ''}`, 'info');
      return;
    }
    if (c.owner === p.accountId) {
      const heir = c.members.find((m) => m.role === 'officer') ?? c.members[0];
      c.owner = heir.id;
      heir.role = 'owner';
    }
    this.chat(c, `${p.name} left the company.`);
    this.sendAll(c);
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
      this.sendInfo(target);
    }
    this.chat(c, `${m.name} was removed from the company.`);
    this.sendAll(c);
  }

  private setRole(p: Player, name: string, role: 'officer' | 'member'): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    if (!c || c.owner !== p.accountId) return;
    const m = c.members.find((x) => x.name.toLowerCase() === String(name).toLowerCase() && x.id !== p.accountId);
    if (!m || m.role === role) return;
    m.role = role;
    this.chat(c, `${m.name} is now ${role === 'officer' ? 'an officer' : 'a member'}.`);
    this.sendAll(c);
  }

  private treasury(p: Player, op: 'deposit' | 'withdraw', amount: number): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    const a = roundCrests(Number(amount));
    if (!c || !(a > 0)) return;
    if (op === 'deposit') {
      if (a > p.crests) return;
      p.crests = roundCrests(p.crests - a);
      c.treasury = roundCrests(c.treasury + a);
      this.log(c, `Deposits`, a);
    } else {
      const me = c.members.find((m) => m.id === p.accountId);
      if (!me || me.role === 'member' || a > c.treasury) {
        if (me?.role === 'member') this.game.notice(p, 'Only officers can take money out.', 'bad');
        return;
      }
      c.treasury = roundCrests(c.treasury - a);
      p.crests = roundCrests(p.crests + a);
      this.log(c, `Withdrawals`, -a);
    }
    p.statusDirty = true;
    this.chat(c, `${p.name} ${op === 'deposit' ? 'deposited' : 'withdrew'} ${formatCrests(a)}. Treasury: ${formatCrests(c.treasury)}.`);
    this.sendAll(c);
  }

  // ——— Property ———

  /** Hands a claim the player owns, and everything of theirs on it, to their company. */
  private transfer(p: Player, claimId: number): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    const claim = this.game.world.structures.get(claimId);
    if (!c || !claim?.def.claimRadius) return;
    if (claim.owner !== p.accountId) {
      this.game.notice(p, 'You can only hand over land you own yourself.', 'bad');
      return;
    }
    const r = claim.def.claimRadius;
    const moved: Structure[] = [];
    for (const s of this.game.world.structures.values())
      if (s.owner === p.accountId && Math.abs(s.x - claim.x) <= r && Math.abs(s.y - claim.y) <= r) moved.push(s);
    for (const s of moved) this.setOwner(s, companyAccount(c.id), c.name);
    this.chat(c, `${p.name} handed ${moved.length} structures on their land to the company.`);
    this.sendAll(c);
    this.game.playerSystem.refreshUi(p, true);
  }

  /** Changes a structure's owner and shows the new name to clients. */
  private setOwner(s: Structure, owner: string, ownerName: string): void {
    s.owner = owner;
    s.ownerName = ownerName;
    this.game.structRemoved(s);
    this.game.structAdded(s);
  }

  /** Gives everything one owner has to another; returns how many structures moved. */
  private reassign(from: string, to: string, toName: string): number {
    let n = 0;
    for (const s of this.game.world.structures.values()) {
      if (s.owner !== from) continue;
      this.setOwner(s, to, toName);
      n++;
    }
    return n;
  }

  /** Money earned by company property (shop sales, shipping). */
  income(owner: string, amount: number, source: string): void {
    const c = this.companies.get(owner.slice(PREFIX.length));
    if (!c || amount <= 0) return;
    c.treasury = roundCrests(c.treasury + amount);
    this.log(c, source, amount);
    this.sendAll(c);
  }

  /** A line in company chat about company property. */
  notify(owner: string, text: string): void {
    const c = this.companies.get(owner.slice(PREFIX.length));
    if (c) this.chat(c, text);
  }

  private log(c: CompanySave, source: string, amount: number): void {
    const now = this.game.minutes;
    c.ledger ??= [];
    c.ledger.push([Math.round(now), source, roundCrests(amount)]);
    c.ledger = c.ledger.filter(([t]) => now - t <= LEDGER_MINUTES);
  }

  // ——— Info ———

  info(p: Player): string {
    const c = p.company ? this.companies.get(p.company) : undefined;
    if (!c) return `You are not in a company. /company create <name> (${formatCrests(FOUNDING_FEE)})`;
    return `${c.name} — treasury ${formatCrests(c.treasury)} — members: ${c.members.map((m) => `${m.name} (${m.role})`).join(', ')}`;
  }

  private overview(p: Player, c: CompanySave): CompanyInfo {
    const account = companyAccount(c.id);
    let count = 0;
    let value = 0;
    const kinds = new Map<string, number>();
    for (const s of this.game.world.structures.values()) {
      if (s.owner !== account) continue;
      count++;
      value += ITEM_BY_ID.get(s.def.item)?.value ?? 0;
      kinds.set(s.type, (kinds.get(s.type) ?? 0) + 1);
    }
    const day = this.game.minutes - 1440;
    const income = new Map<string, number>();
    for (const [t, source, amount] of c.ledger ?? []) if (t >= day) income.set(source, roundCrests((income.get(source) ?? 0) + amount));
    return {
      id: c.id,
      name: c.name,
      treasury: c.treasury,
      you: c.members.find((m) => m.id === p.accountId)?.role ?? 'member',
      members: c.members.map((m) => ({ name: m.name, role: m.role, online: this.game.byAccount.has(m.id) })),
      property: {
        count,
        value: Math.round(value),
        kinds: [...kinds]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([type, n]) => [STRUCTURE_BY_ID.get(type)?.name ?? type, n] as [string, number]),
      },
      income: [...income],
    };
  }

  sendInfo(p: Player): void {
    const c = p.company ? this.companies.get(p.company) : undefined;
    const invite = this.invites.get(p.accountId);
    p.session.send({
      t: 'company',
      info: c ? this.overview(p, c) : null,
      ...(invite && !c ? { invite: this.companies.get(invite)?.name ?? '' } : {}),
    });
  }

  private sendAll(c: CompanySave): void {
    for (const m of c.members) {
      const p = this.game.byAccount.get(m.id);
      if (p) this.sendInfo(p);
    }
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
