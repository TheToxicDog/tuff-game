// The editor's panels: top bar (maps, save, publish, play from here, undo), tool bar, tool
// options, inspector for the selection (including building interiors), layers and status bar.

import {
  BIOME_RULES,
  BIOMES,
  generatePrototypeTown,
  genLayerOf,
  MAP_FORMAT_VERSION,
  MAP_ID_PATTERN,
  regenerateInterior,
  TERRAIN_MATERIALS,
  terrainIndex,
  type BuildingDef,
  type DoorKind,
  type FenceDef,
  type FenceKind,
  type FloorMaterial,
  type MapData,
  type PropInstance,
  type RoadDef,
  type RoadKind,
  type RoomType,
  type TerrainMaterial,
  type ZoneDef,
  type ZoneKind,
} from '@tuff/shared';
import { clear, h } from '../ui/dom';
import type { Editor, EditableLayer, LayerId } from './editor';
import type { Collection, Element } from './history';
import {
  AreaTool,
  button,
  checkField,
  deleteSelection,
  lockEdited,
  numberField,
  rotateSelection,
  selectField,
  toggleLock,
  type ToolId,
} from './tools';

const clone = <T>(v: T): T => structuredClone(v);
const DEG = 180 / Math.PI;

const LAYER_NAMES: [LayerId, string, EditableLayer | null][] = [
  ['terrain', 'Terrain', null],
  ['roads', 'Roads', 'roads'],
  ['buildings', 'Buildings', 'buildings'],
  ['roofs', 'Roofs', null],
  ['props', 'Props', 'props'],
  ['fences', 'Fences', 'fences'],
  ['zones', 'Zombie zones', 'zones'],
  ['spawns', 'Spawns', 'spawns'],
  ['biomes', 'Biomes', null],
  ['locks', 'Lock icons', null],
  ['grid', 'Chunk grid & terrain locks', null],
];

export class EditorUi {
  readonly root: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly toolPanel: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly layersPanel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly title: HTMLElement;
  private readonly dirtyEl: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly toasts: HTMLElement;
  private readonly dialogHost: HTMLElement;
  private saving = false;

  constructor(
    parent: HTMLElement,
    private readonly ed: Editor,
  ) {
    this.title = h('span', { class: 'ed-title' });
    this.dirtyEl = h('span', { class: 'ed-dirty' });
    this.undoBtn = button('↶ Undo', () => ed.undo());
    this.redoBtn = button('↷ Redo', () => ed.redo());
    const top = h(
      'div',
      { class: 'ed-top panel' },
      h('span', { class: 'panel-title' }, 'Map Editor'),
      this.title,
      this.dirtyEl,
      h('span', { class: 'ed-spacer' }),
      button('Maps…', () => void this.openMaps()),
      button('New…', () => this.newMap()),
      button('Template…', () => this.template()),
      this.undoBtn,
      this.redoBtn,
      button('Save', () => void this.save(), 'btn small primary'),
      button('Publish', () => void this.publish()),
      button('▶ Play from here', () => void this.play(), 'btn small primary'),
      button('?', () => this.help()),
    );
    this.toolbar = h('div', { class: 'ed-tools panel' });
    this.toolPanel = h('div', { class: 'ed-section' });
    this.inspector = h('div', { class: 'ed-section' });
    this.layersPanel = h('div', { class: 'ed-section' });
    const side = h(
      'div',
      { class: 'ed-side panel' },
      h('div', { class: 'section-title' }, h('span', null, 'Tool')),
      this.toolPanel,
      h('div', { class: 'section-title' }, h('span', null, 'Inspector')),
      this.inspector,
      h('div', { class: 'section-title' }, h('span', null, 'Layers (eye = show, lock = no editing)')),
      this.layersPanel,
    );
    this.status = h('div', { class: 'ed-status' });
    this.toasts = h('div', { class: 'ed-toasts' });
    this.dialogHost = h('div');
    this.root = h('div', { class: 'editor' }, top, this.toolbar, side, this.status, this.toasts, this.dialogHost);
    for (const el of [top, this.toolbar, side]) el.addEventListener('mousedown', (e) => e.stopPropagation());
    parent.append(this.root);
  }

  refreshAll(): void {
    this.refreshTop();
    this.refreshTools();
    this.refreshInspector();
    this.refreshLayers();
  }

  refreshTop(): void {
    const m = this.ed.map;
    this.title.textContent = `${m.name} (${m.id}) · ${m.width} × ${m.height} m`;
    this.dirtyEl.textContent = this.ed.history.dirty > 0 ? '● unsaved changes' : 'saved';
    this.dirtyEl.classList.toggle('dirty', this.ed.history.dirty > 0);
    this.undoBtn.disabled = !this.ed.history.canUndo;
    this.redoBtn.disabled = !this.ed.history.canRedo;
    this.undoBtn.title = this.ed.history.lastLabel ? `Undo ${this.ed.history.lastLabel} (Ctrl+Z)` : 'Nothing to undo';
    this.redoBtn.title = this.ed.history.nextLabel ? `Redo ${this.ed.history.nextLabel} (Ctrl+Y)` : 'Nothing to redo';
  }

  refreshTools(): void {
    clear(this.toolbar);
    for (const t of Object.values(this.ed.tools)) {
      const key = t.shortcut.replace('Key', '');
      this.toolbar.append(
        h(
          'button',
          {
            class: `ed-tool${t === this.ed.tool ? ' active' : ''}`,
            title: `${t.label} (${key}) — ${t.hint}`,
            on: { click: () => this.ed.setTool(t.id as ToolId) },
          },
          h('b', null, key),
          t.label,
        ),
      );
    }
    this.refreshToolPanel();
  }

  refreshToolPanel(): void {
    clear(this.toolPanel);
    this.toolPanel.append(h('div', { class: 'ed-tool-name' }, this.ed.tool.label));
    const p = this.ed.tool.panel();
    if (p) this.toolPanel.append(p);
  }

  refreshLayers(): void {
    clear(this.layersPanel);
    for (const [id, name, editable] of LAYER_NAMES) {
      const eye = h('input', { type: 'checkbox', title: 'Show' });
      eye.checked = this.ed.layers[id];
      eye.addEventListener('change', () => {
        this.ed.layers[id] = eye.checked;
        this.ed.redraw();
      });
      const row = h('div', { class: 'ed-layer' }, h('label', { class: 'ed-check' }, eye, name));
      if (editable) {
        const lock = h('input', { type: 'checkbox', title: 'Lock layer (no selecting or editing)' });
        lock.checked = this.ed.lockedLayers.has(editable);
        lock.addEventListener('change', () => (lock.checked ? this.ed.lockedLayers.add(editable) : this.ed.lockedLayers.delete(editable)));
        row.append(h('label', { class: 'ed-check fine' }, lock, '🔒'));
      }
      this.layersPanel.append(row);
    }
  }

  refreshStatus(): void {
    const ed = this.ed;
    const sel = ed.selection.length > 0 ? ` · ${ed.selection.length} selected` : '';
    this.status.textContent = `${ed.describePointer()} · zoom ${ed.camera.zoom.toFixed(2)}×${sel} · ${ed.tool.hint}`;
    this.refreshTop();
  }

  toast(text: string, level: 'info' | 'warn' | 'good' = 'info'): void {
    const el = h('div', { class: `notice ${level}` }, text);
    this.toasts.append(el);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild!.remove();
    window.setTimeout(() => {
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 400);
    }, 4000);
  }

  // =============================================================================================
  // Inspector

  private edit(coll: Collection, el: Element, label: string, mutate: (copy: Element) => void): void {
    const next = clone(el);
    mutate(next);
    const tx = this.ed.begin(label);
    tx.set(coll, next);
    this.ed.commit(tx);
  }

  refreshInspector(): void {
    const ed = this.ed;
    const box = this.inspector;
    clear(box);
    // Furniture inside the interior being edited.
    const interior = ed.interior ? (ed.find('buildings', ed.interior) as BuildingDef | undefined) : undefined;
    if (interior && ed.selectedInteriorProp) {
      const p = interior.props.find((pp) => pp.id === ed.selectedInteriorProp);
      if (p) {
        box.append(this.interiorPropInspector(interior, p));
        return;
      }
    }
    if (ed.selection.length === 0) {
      box.append(this.mapInspector());
      return;
    }
    if (ed.selection.length > 1) {
      const counts = new Map<string, number>();
      for (const s of ed.selection) counts.set(s.coll, (counts.get(s.coll) ?? 0) + 1);
      box.append(
        h('div', null, [...counts].map(([k, v]) => `${v} ${k}`).join(', ')),
        h(
          'div',
          { class: 'ed-buttons' },
          button('Lock (L)', () => toggleLock(ed, true)),
          button('Unlock', () => toggleLock(ed, false)),
          button('Rotate 90° (Shift+R)', () => rotateSelection(ed, Math.PI / 2)),
          button('Delete (Del)', () => deleteSelection(ed), 'btn small danger'),
        ),
      );
      return;
    }
    const s = ed.selection[0];
    if (s.coll === 'spawns') {
      const sp = ed.map.spawns[Number(s.id)];
      box.append(
        h('div', null, `Spawn point at ${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}`),
        h(
          'div',
          { class: 'ed-buttons' },
          button('Delete', () => deleteSelection(ed), 'btn small danger'),
        ),
      );
      return;
    }
    const coll: Collection = s.coll;
    const el = ed.find(coll, s.id);
    if (!el) return;
    const layer = coll === 'zones' ? null : genLayerOf(coll, el as never);
    const origin = el.manual
      ? 'Placed by hand — never regenerated'
      : `Generated (${el.gen ?? layer ?? 'parcels'})${el.locked ? ' — locked, regeneration keeps it' : ' — regeneration may replace it'}`;
    box.append(h('div', { class: 'fine' }, `${coll.slice(0, -1)} ${el.id}`), h('div', { class: 'fine' }, origin));
    box.append(
      checkField(
        'Locked',
        () => !!el.locked,
        (v) =>
          this.edit(coll, el, v ? 'Lock' : 'Unlock', (c) => {
            if (v) c.locked = true;
            else delete c.locked;
          }),
      ),
    );
    switch (coll) {
      case 'buildings':
        box.append(this.buildingInspector(el as BuildingDef));
        break;
      case 'roads':
        box.append(this.roadInspector(el as RoadDef));
        break;
      case 'props':
        box.append(this.propInspector(el as PropInstance));
        break;
      case 'fences': {
        const f = el as FenceDef;
        box.append(
          selectField(
            'Kind',
            ['wood', 'chainlink', 'picket'] as FenceKind[],
            () => f.kind,
            (v) => this.edit('fences', f, 'Fence kind', (c) => ((c as FenceDef).kind = v)),
          ),
          h('div', { class: 'fine' }, `${f.points.length} posts · drag the handles · Alt+click inserts · right-click removes`),
        );
        break;
      }
      case 'zones':
        box.append(this.zoneInspector(el as ZoneDef));
        break;
    }
    box.append(
      h(
        'div',
        { class: 'ed-buttons' },
        button('Delete (Del)', () => deleteSelection(ed), 'btn small danger'),
      ),
    );
  }

  private mapInspector(): HTMLElement {
    const ed = this.ed;
    const m = ed.map;
    const nameInput = h('input', { type: 'text', value: m.name, maxLength: 80 });
    nameInput.addEventListener('change', () => {
      const tx = ed.begin('Rename map');
      tx.meta({ name: nameInput.value.trim() || m.name, seed: m.seed });
      ed.commit(tx);
    });
    const count = (arr: Element[]) => {
      let locked = 0;
      let manual = 0;
      for (const e of arr) {
        if (e.locked) locked++;
        if (e.manual) manual++;
      }
      return `${arr.length} (${locked} locked, ${manual} hand-placed)`;
    };
    const biomeCounts = new Map<string, number>();
    for (const v of ed.biomeCells) if (v) biomeCounts.set(BIOMES[v], (biomeCounts.get(BIOMES[v]) ?? 0) + 1);
    return h(
      'div',
      null,
      h('label', { class: 'ed-field' }, h('span', null, 'Map name'), nameInput),
      h('div', { class: 'fine' }, `Buildings ${count(m.buildings)}`),
      h('div', { class: 'fine' }, `Roads ${count(m.roads)}`),
      h('div', { class: 'fine' }, `Props ${count(m.props)}`),
      h('div', { class: 'fine' }, `Fences ${count(m.fences)} · zones ${m.zones.length} · spawns ${m.spawns.length}`),
      h(
        'div',
        { class: 'fine' },
        `Biomes: ${biomeCounts.size === 0 ? 'none painted' : [...biomeCounts].map(([b, n]) => `${BIOME_RULES[b as never as keyof typeof BIOME_RULES].label} ${Math.round((n * 256) / 10000)} ha`).join(', ')}`,
      ),
      h('div', { class: 'fine' }, `Terrain chunks locked: ${(m.terrainLocked ?? []).length}`),
      h(
        'div',
        { class: 'ed-buttons' },
        button('Regenerate unlocked…', () => {
          ed.setTool('area');
          (ed.tools.area as AreaTool).area = null;
          this.refreshToolPanel();
        }),
      ),
    );
  }

  private buildingInspector(b: BuildingDef): HTMLElement {
    const ed = this.ed;
    const name = h('input', { type: 'text', value: b.name ?? '', placeholder: '(unnamed)' });
    name.addEventListener('change', () =>
      this.edit('buildings', b, 'Rename building', (c) => {
        const v = name.value.trim();
        if (v) (c as BuildingDef).name = v;
        else delete (c as BuildingDef).name;
        lockEdited(c);
      }),
    );
    const rooms = h('div', { class: 'ed-list short' });
    const ROOM_TYPES: RoomType[] = [
      'living',
      'kitchen',
      'bathroom',
      'bedroom',
      'hallway',
      'garage',
      'utility',
      'dining',
      'office',
      'closet',
      'sales',
      'storage',
      'stockroom',
      'breakroom',
      'armory',
      'lockers',
      'cells',
      'lobby',
      'pharmacy',
    ];
    const FLOORS: FloorMaterial[] = ['wood', 'tile', 'carpet', 'concrete', 'linoleum', 'checker', 'darkwood'];
    b.rooms.forEach((r, i) => {
      rooms.append(
        h(
          'div',
          { class: 'ed-row' },
          selectField(
            `Room ${i + 1}`,
            ROOM_TYPES,
            () => r.type,
            (v) => this.edit('buildings', b, 'Room type', (c) => lockEdited(c) && ((c as BuildingDef).rooms[i].type = v)),
          ),
          selectField(
            'Floor',
            FLOORS,
            () => r.floor,
            (v) => this.edit('buildings', b, 'Floor', (c) => lockEdited(c) && ((c as BuildingDef).rooms[i].floor = v)),
          ),
        ),
      );
    });
    const doors = h('div', { class: 'ed-list short' });
    const DOOR_KINDS: DoorKind[] = ['wood', 'exterior', 'glass', 'metal', 'garage', 'cell'];
    b.doors.forEach((d, i) => {
      doors.append(
        h(
          'div',
          { class: 'ed-row' },
          selectField(
            `Door ${i + 1}`,
            DOOR_KINDS,
            () => d.kind,
            (v) => this.edit('buildings', b, 'Door kind', (c) => lockEdited(c) && ((c as BuildingDef).doors[i].kind = v)),
          ),
          checkField(
            'locked',
            () => !!d.locked,
            (v) => this.edit('buildings', b, 'Lock door', (c) => lockEdited(c) && ((c as BuildingDef).doors[i].locked = v || undefined)),
          ),
          checkField(
            'open',
            () => !!d.open,
            (v) => this.edit('buildings', b, 'Open door', (c) => lockEdited(c) && ((c as BuildingDef).doors[i].open = v || undefined)),
          ),
        ),
      );
    });
    return h(
      'div',
      null,
      h(
        'div',
        null,
        `${b.type.replace('_', ' ')} · ${b.w.toFixed(1)} × ${b.h.toFixed(1)} m · ${b.rooms.length} rooms · ${b.props.length} furnishings`,
      ),
      h('label', { class: 'ed-field' }, h('span', null, 'Name'), name),
      numberField(
        'X',
        () => b.x,
        (v) => this.edit('buildings', b, 'Move building', (c) => lockEdited(c) && ((c as BuildingDef).x = v)),
        { step: 0.5 },
      ),
      numberField(
        'Y',
        () => b.y,
        (v) => this.edit('buildings', b, 'Move building', (c) => lockEdited(c) && ((c as BuildingDef).y = v)),
        { step: 0.5 },
      ),
      numberField(
        'Rotation (°)',
        () => Math.round(b.rot * DEG),
        (v) =>
          this.edit(
            'buildings',
            b,
            'Rotate building',
            (c) => lockEdited(c) && ((c as BuildingDef).rot = Math.round((v / DEG) * 1000) / 1000),
          ),
        { step: 15 },
      ),
      h(
        'div',
        { class: 'ed-buttons' },
        button('Edit interior (I)', () => ed.enterInterior(b.id)),
        button('Regenerate interior', () => {
          if (b.locked) {
            this.toast('Unlock the building to regenerate its interior.', 'warn');
            return;
          }
          const next = regenerateInterior(b, (Math.random() * 2 ** 31) >>> 0);
          const tx = ed.begin('Regenerate interior');
          tx.remove('buildings', b.id);
          tx.add('buildings', next);
          ed.commit(tx);
          ed.select([{ coll: 'buildings', id: next.id }]);
        }),
      ),
      h('div', { class: 'section-title' }, h('span', null, 'Rooms')),
      rooms,
      h('div', { class: 'section-title' }, h('span', null, 'Doors')),
      doors,
      h('div', { class: 'fine' }, 'In interior mode, place furniture with the Props tool and move it with the select tool.'),
    );
  }

  private roadInspector(r: RoadDef): HTMLElement {
    const set = (label: string, fn: (c: RoadDef) => void) => this.edit('roads', r, label, (c) => lockEdited(c) && fn(c as RoadDef));
    return h(
      'div',
      null,
      selectField(
        'Kind',
        ['highway', 'main', 'street', 'country', 'dirt', 'driveway'] as RoadKind[],
        () => r.kind,
        (v) => set('Road kind', (c) => (c.kind = v)),
      ),
      numberField(
        'Width (m)',
        () => r.width,
        (v) => set('Road width', (c) => (c.width = v)),
        { min: 1, max: 40, step: 0.5 },
      ),
      numberField(
        'Sidewalk (m)',
        () => r.sidewalk,
        (v) => set('Sidewalk', (c) => (c.sidewalk = v)),
        { min: 0, max: 6, step: 0.1 },
      ),
      numberField(
        'Lanes',
        () => r.lanes,
        (v) => set('Lanes', (c) => (c.lanes = v)),
        { min: 1, max: 6 },
      ),
      selectField(
        'Surface',
        ['asphalt', 'concrete', 'gravel', 'dirt'] as const,
        () => r.surface,
        (v) => set('Surface', (c) => (c.surface = v)),
      ),
      checkField(
        'Lane markings',
        () => r.markings,
        (v) => set('Markings', (c) => (c.markings = v)),
      ),
      h('div', { class: 'fine' }, `${r.points.length} points · drag the handles · Alt+click inserts · right-click removes`),
    );
  }

  private propInspector(p: PropInstance): HTMLElement {
    const set = (label: string, fn: (c: PropInstance) => void) =>
      this.edit('props', p, label, (c) => lockEdited(c) && fn(c as PropInstance));
    const def = this.ed.content.findProp(p.type);
    return h(
      'div',
      null,
      selectField(
        'Type',
        this.ed.content.props.map((d) => d.id),
        () => p.type,
        (v) => set('Prop type', (c) => (c.type = v)),
        (id) => this.ed.content.findProp(id)?.name ?? id,
      ),
      numberField(
        'X',
        () => p.x,
        (v) => set('Move prop', (c) => (c.x = v)),
        { step: 0.1 },
      ),
      numberField(
        'Y',
        () => p.y,
        (v) => set('Move prop', (c) => (c.y = v)),
        { step: 0.1 },
      ),
      numberField(
        'Rotation (°)',
        () => Math.round(p.rot * DEG),
        (v) => set('Rotate prop', (c) => (c.rot = Math.round((v / DEG) * 1000) / 1000)),
        { step: 15 },
      ),
      def?.container ? this.lootField(p.loot ?? '', (v) => set('Loot table', (c) => (v ? (c.loot = v) : delete c.loot))) : null,
    );
  }

  private lootField(value: string, set: (v: string) => void): HTMLElement {
    const input = h('input', { type: 'text', value, placeholder: '(default loot table)' });
    input.addEventListener('change', () => set(input.value.trim()));
    return h('label', { class: 'ed-field' }, h('span', null, 'Loot table'), input);
  }

  private interiorPropInspector(b: BuildingDef, p: PropInstance): HTMLElement {
    const ed = this.ed;
    const set = (label: string, fn: (c: PropInstance) => void) =>
      this.edit('buildings', b, label, (c) => {
        lockEdited(c);
        const target = (c as BuildingDef).props.find((x) => x.id === p.id);
        if (target) fn(target);
      });
    const def = ed.content.findProp(p.type);
    return h(
      'div',
      null,
      h('div', { class: 'fine' }, `Furniture in ${b.name ?? b.type} (local coordinates)`),
      selectField(
        'Type',
        ed.content.props.map((d) => d.id),
        () => p.type,
        (v) => set('Furniture type', (c) => (c.type = v)),
        (id) => ed.content.findProp(id)?.name ?? id,
      ),
      numberField(
        'Local X',
        () => p.x,
        (v) => set('Move furniture', (c) => (c.x = v)),
        { step: 0.05 },
      ),
      numberField(
        'Local Y',
        () => p.y,
        (v) => set('Move furniture', (c) => (c.y = v)),
        { step: 0.05 },
      ),
      numberField(
        'Rotation (°)',
        () => Math.round(p.rot * DEG),
        (v) => set('Rotate furniture', (c) => (c.rot = Math.round((v / DEG) * 1000) / 1000)),
        { step: 15 },
      ),
      def?.container ? this.lootField(p.loot ?? '', (v) => set('Loot table', (c) => (v ? (c.loot = v) : delete c.loot))) : null,
      h(
        'div',
        { class: 'ed-buttons' },
        button('Rotate 90°', () => rotateSelection(ed, Math.PI / 2)),
        button('Delete (Del)', () => deleteSelection(ed), 'btn small danger'),
      ),
    );
  }

  private zoneInspector(z: ZoneDef): HTMLElement {
    const set = (label: string, fn: (c: ZoneDef) => void) => this.edit('zones', z, label, (c) => fn(c as ZoneDef));
    const name = h('input', { type: 'text', value: z.name, maxLength: 60 });
    name.addEventListener('change', () => set('Rename zone', (c) => (c.name = name.value.trim() || c.name)));
    return h(
      'div',
      null,
      h('label', { class: 'ed-field' }, h('span', null, 'Name'), name),
      selectField(
        'Kind',
        ['residential', 'commercial', 'forest', 'rural', 'industrial', 'downtown'] as ZoneKind[],
        () => z.kind,
        (v) => set('Zone kind', (c) => (c.kind = v)),
      ),
      numberField(
        'Zombies',
        () => z.zombies,
        (v) => set('Zone population', (c) => (c.zombies = Math.round(v))),
        { min: 0, max: 100000 },
      ),
      h(
        'div',
        { class: 'fine' },
        `${Math.round(z.rect[2])} × ${Math.round(z.rect[3])} m at ${Math.round(z.rect[0])}, ${Math.round(z.rect[1])} · drag corners to resize`,
      ),
    );
  }

  // =============================================================================================
  // Dialogs

  private dialog(
    title: string,
    body: HTMLElement,
    actions: { label: string; primary?: boolean; danger?: boolean; run: () => boolean | void }[],
  ): void {
    const close = () => backdrop.remove();
    const buttons = actions.map((a) =>
      button(
        a.label,
        () => {
          if (a.run() !== false) close();
        },
        `btn small${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`,
      ),
    );
    const backdrop = h(
      'div',
      { class: 'modal-backdrop ed-dialog-backdrop' },
      h(
        'div',
        { class: 'panel ed-dialog' },
        h('div', { class: 'panel-title' }, title),
        body,
        h('div', { class: 'ed-buttons right' }, ...buttons, button('Cancel', close)),
      ),
    );
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close();
      e.stopPropagation();
    });
    this.dialogHost.append(backdrop);
  }

  private async openMaps(): Promise<void> {
    const ed = this.ed;
    let list: Awaited<ReturnType<Editor['api']['maps']>>;
    try {
      list = await ed.api.maps();
    } catch (err) {
      this.toast((err as Error).message, 'warn');
      return;
    }
    const body = h('div', { class: 'ed-list' });
    for (const m of list.maps) {
      body.append(
        h(
          'button',
          {
            class: 'ed-list-item',
            on: {
              click: async () => {
                if (ed.history.dirty > 0 && !window.confirm('Discard unsaved changes?')) return;
                try {
                  ed.loadMap(await ed.api.load(m.id));
                  this.toast(`Opened ${m.id}.`);
                  (this.dialogHost.lastElementChild as HTMLElement | null)?.remove();
                } catch (err) {
                  this.toast((err as Error).message, 'warn');
                }
              },
            },
          },
          m.id,
          h(
            'span',
            { class: 'fine' },
            ` ${m.id === list.liveMap ? '· live on this server' : ''}${m.bytes ? ` · ${Math.round(m.bytes / 1024)} KiB` : ''}`,
          ),
        ),
      );
    }
    this.dialog('Open a map', body, []);
  }

  private newMap(): void {
    let id = 'new_map';
    let name = 'New Map';
    let size = 640;
    let fill: TerrainMaterial = 'grass';
    const body = h(
      'div',
      null,
      h(
        'label',
        { class: 'ed-field' },
        h('span', null, 'Id (file name)'),
        inputOf(id, (v) => (id = v)),
      ),
      h(
        'label',
        { class: 'ed-field' },
        h('span', null, 'Name'),
        inputOf(name, (v) => (name = v)),
      ),
      numberField(
        'Size (m, multiple of 64)',
        () => size,
        (v) => (size = Math.max(128, Math.min(4096, Math.round(v / 64) * 64))),
        { min: 128, max: 4096, step: 64 },
      ),
      selectField(
        'Ground',
        TERRAIN_MATERIALS,
        () => fill,
        (v) => (fill = v),
      ),
      h(
        'div',
        { class: 'fine' },
        'The design plan suggests about 4 × 4 km for the full first map. Paint biomes, draw a few roads, then use Generate.',
      ),
    );
    this.dialog('New map', body, [
      {
        label: 'Create',
        primary: true,
        run: () => {
          if (!MAP_ID_PATTERN.test(id)) {
            this.toast('Ids use a–z, 0–9, _ and -.', 'warn');
            return false;
          }
          if (this.ed.history.dirty > 0 && !window.confirm('Discard unsaved changes?')) return false;
          const map: MapData = {
            format: MAP_FORMAT_VERSION,
            id,
            name,
            width: size,
            height: size,
            seed: (Math.random() * 2 ** 31) >>> 0,
            terrain: { fill: terrainIndex(fill), chunks: {} },
            roads: [],
            buildings: [],
            props: [],
            fences: [],
            zones: [],
            spawns: [{ x: size / 2, y: size / 2 }],
          };
          this.ed.loadMap(map);
          this.ed.history.dirty = 1;
          this.ed.camera.snapTo(size / 2, size / 2);
          this.refreshTop();
          return true;
        },
      },
    ]);
  }

  private template(): void {
    let seed = 1337;
    const body = h(
      'div',
      null,
      h(
        'div',
        { class: 'fine' },
        'Replaces the whole map with the Pine Valley template generated from a seed (keeps the map id). You can undo this.',
      ),
      numberField(
        'Seed',
        () => seed,
        (v) => (seed = Math.floor(v) >>> 0),
        { min: 0 },
      ),
    );
    this.dialog('Pine Valley template', body, [
      {
        label: 'Generate',
        danger: true,
        run: () => {
          const ed = this.ed;
          const next = generatePrototypeTown(seed);
          const tx = ed.begin(`Pine Valley template (seed ${seed})`);
          for (const c of ['roads', 'buildings', 'props', 'fences', 'zones'] as Collection[]) {
            tx.removeMany(
              c,
              (ed.map[c] as Element[]).map((e) => e.id),
            );
            tx.addMany(c, next[c] as Element[]);
          }
          const keys = new Set([...Object.keys(ed.map.terrain.chunks), ...Object.keys(next.terrain.chunks)]);
          for (const k of keys) tx.terrain(k, next.terrain.chunks[k]);
          tx.spawns(next.spawns);
          tx.meta({ name: ed.map.name, seed });
          if (ed.map.width !== next.width || ed.map.height !== next.height) {
            this.toast('The template is 640 × 640 m; create a new 640 m map for it.', 'warn');
            return false;
          }
          ed.select([]);
          ed.commit(tx);
          return true;
        },
      },
    ]);
  }

  private help(): void {
    const rows: [string, string][] = [
      ['Pan', 'Right or middle drag, Space+drag, WASD / arrows'],
      ['Zoom', 'Mouse wheel'],
      [
        'Tools',
        Object.values(this.ed.tools)
          .map((t) => `${t.shortcut.replace('Key', '')} ${t.label}`)
          .join(' · '),
      ],
      ['Undo / redo', 'Ctrl+Z / Ctrl+Y'],
      ['Save', 'Ctrl+S (writes data/maps/<id>.json on the server)'],
      ['Publish', 'Rebuilds the live world from the saved map; players reconnect'],
      ['Play from here', 'Saves, publishes and drops you into the game at the view centre'],
      [
        'Locking',
        'L locks the selection. Regeneration never touches locked or hand-placed elements, and editing a generated element locks it.',
      ],
      ['Interiors', 'Double-click a building; place furniture with Props, move it with Select'],
    ];
    const table = h('table', { class: 'controls-table' });
    for (const [a, b] of rows) table.append(h('tr', null, h('td', null, a), h('td', null, b)));
    this.dialog('Editor help', table, []);
  }

  // =============================================================================================
  // Save, publish, play

  async save(): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    try {
      await this.ed.api.save(this.ed.map);
      this.ed.history.dirty = 0;
      this.toast(`Saved ${this.ed.map.id}.`, 'good');
      return true;
    } catch (err) {
      this.toast(`Save failed: ${(err as Error).message}`, 'warn');
      return false;
    } finally {
      this.saving = false;
      this.refreshTop();
    }
  }

  async publish(): Promise<boolean> {
    if (!window.confirm(`Publish "${this.ed.map.id}"? The live world is rebuilt from it and everyone playing reconnects.`)) return false;
    if (!(await this.save())) return false;
    try {
      await this.ed.api.publish(this.ed.map.id);
      this.toast('Published: the world was rebuilt from this map and players reconnected.', 'good');
      return true;
    } catch (err) {
      this.toast(`Publish failed: ${(err as Error).message}`, 'warn');
      return false;
    }
  }

  private async play(): Promise<void> {
    const ed = this.ed;
    const x = Math.round(ed.camera.x);
    const y = Math.round(ed.camera.y);
    if (!(await this.publish())) return;
    location.href = `/?tp=${x},${y}&editor=${encodeURIComponent(ed.map.id)}`;
  }
}

function inputOf(value: string, set: (v: string) => void): HTMLInputElement {
  const input = h('input', { type: 'text', value });
  input.addEventListener('input', () => set(input.value.trim()));
  return input;
}
