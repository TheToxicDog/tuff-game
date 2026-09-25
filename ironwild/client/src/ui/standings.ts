// The Standings window (L, §63): your ambitions — the wealth ladder and the endgame feats — and
// the server's leaders by worth, the day's takings and prestige, plus who dominates trade where.

import { AMBITION_BY_ID, formatCrests, type AmbitionInfo, type StandingRow } from '@ironwild/shared';
import type { UiContext } from '../game/state';
import { h } from './dom';
import type { WindowDef } from './windows';

export type StandingsTab = 'ambitions' | 'leaders';

export function standingsWindow(ctx: UiContext, tab: { value: StandingsTab }): WindowDef {
  const pick = (t: StandingsTab, label: string) =>
    h(
      'button',
      {
        class: `small${tab.value === t ? ' gold' : ''}`,
        onclick: () => {
          tab.value = t;
          ctx.refresh('standings');
        },
      },
      label,
    );
  return {
    title: () => h('span', { class: 'row' }, 'Standings ', pick('ambitions', 'Your ambitions'), pick('leaders', 'Leaders')),
    order: 1,
    width: 600,
    render: (body) => {
      const s = ctx.state.standings;
      if (!s) {
        body.append(h('div', { class: 'muted' }, 'Counting…'));
        return;
      }
      body.append(
        h(
          'div',
          { class: 'standing-you' },
          h('div', null, h('div', { class: 'muted' }, 'Title'), h('b', { class: 'gold' }, s.you.title ?? '—')),
          h('div', null, h('div', { class: 'muted' }, 'Worth'), h('b', { class: 'crests' }, formatCrests(Math.round(s.you.worth)))),
          h('div', null, h('div', { class: 'muted' }, 'Today'), h('b', null, formatCrests(s.you.today))),
          h('div', null, h('div', { class: 'muted' }, 'Prestige'), h('b', null, `★ ${s.you.prestige}`)),
        ),
      );
      if (tab.value === 'ambitions') renderAmbitions(body, s.ambitions);
      else renderLeaders(body, s.boards, s.towns);
    },
  };
}

function renderAmbitions(body: HTMLElement, list: AmbitionInfo[]): void {
  const row = (a: AmbitionInfo) => {
    const def = AMBITION_BY_ID.get(a.id);
    if (!def) return null;
    return h(
      'div',
      { class: `ambition${a.done ? ' done' : ''}` },
      h('div', { class: 'mark' }, a.done ? '✔' : '○'),
      h(
        'div',
        { style: 'flex:1;min-width:0' },
        h('div', { class: 'row' }, h('b', null, def.title), h('span', { class: 'pill' }, `★ ${def.prestige}`)),
        h('div', { class: 'muted', style: 'font-size:12px' }, def.desc),
        a.done
          ? null
          : h(
              'div',
              { class: 'row', style: 'gap:8px;margin-top:3px' },
              h('div', { class: 'progress', style: 'flex:1' }, h('div', { style: `width:${Math.round(a.progress * 100)}%` })),
              h('span', { style: 'font-size:12px;white-space:nowrap' }, a.text),
            ),
      ),
    );
  };
  const ranks = list.filter((a) => AMBITION_BY_ID.get(a.id)?.rank);
  const feats = list.filter((a) => !AMBITION_BY_ID.get(a.id)?.rank);
  body.append(
    h('div', { class: 'section-title' }, 'The wealth ladder'),
    h(
      'div',
      { class: 'muted', style: 'font-size:12px;margin-bottom:6px' },
      'Your worth is your Crests, what you carry, and everything you own out in the world — with what is in it. The highest rung you reach is shown under your name. A company you belong to counts too.',
    ),
    ...ranks.map(row).filter((x): x is HTMLDivElement => !!x),
    h('div', { class: 'section-title' }, 'Feats'),
    ...feats.map(row).filter((x): x is HTMLDivElement => !!x),
  );
}

function renderLeaders(
  body: HTMLElement,
  boards: { title: string; unit: 'crests' | 'points'; rows: StandingRow[] }[],
  towns: { name: string; rows: StandingRow[] }[],
): void {
  const line = (r: StandingRow, i: number, unit: 'crests' | 'points') =>
    h(
      'div',
      { class: `leader${r.you ? ' you' : ''}` },
      h('span', { class: 'place' }, `${i + 1}.`),
      h('span', { class: `dot ${r.online ? 'on' : ''}` }),
      h(
        'span',
        { class: 'who' },
        r.company ? h('span', { class: 'muted' }, `[${r.company}] `) : null,
        r.name,
        r.title ? h('span', { class: 'rank' }, ` ${r.title}`) : null,
      ),
      h('span', { class: unit === 'crests' ? 'crests' : 'gold' }, unit === 'crests' ? formatCrests(r.value) : `★ ${r.value}`),
    );
  const grid = h('div', { class: 'boards' });
  for (const b of boards)
    grid.append(
      h(
        'div',
        { class: 'town-card' },
        h('div', { class: 'name' }, b.title),
        ...(b.rows.length ? b.rows.map((r, i) => line(r, i, b.unit)) : [h('div', { class: 'muted' }, 'Nobody yet.')]),
      ),
    );
  body.append(grid, h('div', { class: 'section-title' }, 'Who trades where'));
  const tgrid = h('div', { class: 'boards' });
  for (const t of towns)
    tgrid.append(
      h(
        'div',
        { class: 'town-card' },
        h('div', { class: 'name' }, t.name),
        ...(t.rows.length ? t.rows.map((r, i) => line(r, i, 'crests')) : [h('div', { class: 'muted' }, 'Nobody has sold here yet.')]),
      ),
    );
  body.append(tgrid);
}
