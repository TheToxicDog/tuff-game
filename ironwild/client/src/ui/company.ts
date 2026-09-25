// The company window (C, §46): found or join a company, the treasury, members and their roles,
// what the company owns and what it earned over the last day.

import { formatCrests } from '@ironwild/shared';
import type { UiContext } from '../game/state';
import { h } from './dom';
import type { WindowDef } from './windows';

export function companyWindow(ctx: UiContext): WindowDef {
  return {
    title: () => h('span', null, ctx.state.company ? ctx.state.company.name : 'Company'),
    order: 1,
    width: 460,
    render: (body) => {
      const c = ctx.state.company;
      if (!c) return noCompany(body, ctx);
      const officer = c.you === 'owner' || c.you === 'officer';

      // Treasury.
      const amount = h('input', { type: 'number', min: '1', placeholder: 'amount', style: 'width:90px' }) as HTMLInputElement;
      const money = (op: 'deposit' | 'withdraw') => {
        const n = Number(amount.value);
        if (n > 0) ctx.send({ t: 'company', op, amount: n });
      };
      body.append(
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'gold', style: 'font-size:20px;font-weight:700' }, formatCrests(c.treasury)),
          h('span', { class: 'muted' }, ' in the treasury'),
        ),
        h(
          'div',
          { class: 'row', style: 'margin-top:6px' },
          amount,
          h('button', { class: 'small', onclick: () => money('deposit') }, 'Deposit'),
          officer ? h('button', { class: 'small', onclick: () => money('withdraw') }, 'Withdraw') : null,
        ),
      );

      // Last day's money.
      body.append(h('div', { class: 'section-title' }, 'Last day'));
      if (c.income.length === 0)
        body.append(h('div', { class: 'muted' }, 'Nothing yet. Company shop stands and shipping crates pay into the treasury.'));
      for (const [source, n] of c.income)
        body.append(
          h(
            'div',
            { class: 'row' },
            h('span', { style: 'flex:1' }, source),
            h('span', { class: n >= 0 ? 'good' : 'bad' }, formatCrests(n)),
          ),
        );

      // Members.
      body.append(h('div', { class: 'section-title' }, `Members (${c.members.length})`));
      for (const m of c.members) {
        const row = h(
          'div',
          { class: 'row', style: 'margin-bottom:3px' },
          h('span', { class: `dot ${m.online ? 'on' : ''}` }),
          h('span', { style: 'flex:1' }, m.name),
          h('span', { class: 'pill' }, m.role),
        );
        if (c.you === 'owner' && m.role !== 'owner') {
          row.append(
            m.role === 'member'
              ? h('button', { class: 'small', onclick: () => ctx.send({ t: 'company', op: 'promote', name: m.name }) }, 'Make officer')
              : h('button', { class: 'small', onclick: () => ctx.send({ t: 'company', op: 'demote', name: m.name }) }, 'Demote'),
            h('button', { class: 'small red', onclick: () => ctx.send({ t: 'company', op: 'kick', name: m.name }) }, 'Remove'),
          );
        }
        body.append(row);
      }
      if (officer) {
        const who = h('input', { placeholder: 'player name', style: 'flex:1' }) as HTMLInputElement;
        body.append(
          h(
            'div',
            { class: 'row', style: 'margin-top:6px' },
            who,
            h(
              'button',
              { class: 'small', onclick: () => who.value && ctx.send({ t: 'company', op: 'invite', name: who.value }) },
              'Invite',
            ),
          ),
        );
      }

      // Property.
      body.append(h('div', { class: 'section-title' }, 'Property'));
      if (c.property.count === 0)
        body.append(
          h(
            'div',
            { class: 'muted' },
            'The company owns nothing yet. Open one of your land claims (E) and hand it over — everything of yours on it goes with it.',
          ),
        );
      else {
        body.append(h('div', null, `${c.property.count} structures worth ${formatCrests(c.property.value)}`));
        body.append(h('div', { class: 'muted', style: 'font-size:12px' }, c.property.kinds.map(([k, n]) => `${n} ${k}`).join(' · ')));
      }
      body.append(
        h(
          'div',
          { class: 'muted', style: 'font-size:12px;margin-top:8px' },
          'Members use and build on company land; officers also pick things up, set shop prices and manage who else may use it. Company chat: /c <message>.',
        ),
        h(
          'div',
          { class: 'row', style: 'margin-top:8px' },
          h('span', { class: 'spacer' }),
          h(
            'button',
            { class: 'small red', onclick: () => confirm(`Leave ${c.name}?`) && ctx.send({ t: 'company', op: 'leave' }) },
            'Leave company',
          ),
        ),
      );
    },
  };
}

function noCompany(body: HTMLElement, ctx: UiContext): void {
  const invite = ctx.state.companyInvite;
  if (invite) {
    body.append(
      h('div', { class: 'invite' }, `You are invited to join ${invite}.`),
      h(
        'div',
        { class: 'row', style: 'margin:6px 0 12px' },
        h('button', { class: 'small gold', onclick: () => ctx.send({ t: 'company', op: 'accept' }) }, 'Join'),
        h('button', { class: 'small', onclick: () => ctx.send({ t: 'company', op: 'decline' }) }, 'Decline'),
      ),
    );
  }
  const name = h('input', { placeholder: 'company name', maxlength: '28', style: 'flex:1' }) as HTMLInputElement;
  body.append(
    h(
      'div',
      { class: 'muted' },
      'A company pools money, land and factories. Members share its machines and storage, and whatever its shop stands and shipping crates earn goes to the treasury.',
    ),
    h('div', { class: 'section-title' }, 'Found a company (₡500)'),
    h(
      'div',
      { class: 'row' },
      name,
      h('button', { class: 'small gold', onclick: () => ctx.send({ t: 'company', op: 'create', name: name.value }) }, 'Found'),
    ),
  );
}
