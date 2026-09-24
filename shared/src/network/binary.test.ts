import { describe, expect, it } from 'vitest';
import { BinaryReader, BinaryReadError, BinaryWriter } from './binary';
import {
  DeltaBits,
  EntityKind,
  NetEventType,
  decodeInputs,
  decodeSnapshot,
  encodeInputs,
  quantizeInput,
  readSelfState,
  writeEvent,
  writeSelfState,
  writeSpawn,
  writeUpdate,
  type NetEntity,
} from './protocol';
import { createPlayerSimState } from '../sim/player';

describe('BinaryWriter / BinaryReader', () => {
  it('round-trips primitive values and grows its buffer', () => {
    const w = new BinaryWriter(4);
    w.u8(250).i8(-100).u16(60000).i16(-30000).u32(4000000000).i32(-2000000000).f32(1.5).f64(Math.PI);
    w.varuint(0).varuint(127).varuint(128).varuint(300000).varuint(0xffffffff);
    w.string('héllo zombie 🧟').bool(true).unit8(0.5);
    const r = new BinaryReader(w.finish());
    expect(r.u8()).toBe(250);
    expect(r.i8()).toBe(-100);
    expect(r.u16()).toBe(60000);
    expect(r.i16()).toBe(-30000);
    expect(r.u32()).toBe(4000000000);
    expect(r.i32()).toBe(-2000000000);
    expect(r.f32()).toBe(1.5);
    expect(r.f64()).toBe(Math.PI);
    expect(r.varuint()).toBe(0);
    expect(r.varuint()).toBe(127);
    expect(r.varuint()).toBe(128);
    expect(r.varuint()).toBe(300000);
    expect(r.varuint()).toBe(0xffffffff);
    expect(r.string()).toBe('héllo zombie 🧟');
    expect(r.bool()).toBe(true);
    expect(r.unit8()).toBeCloseTo(0.5, 2);
    expect(r.remaining).toBe(0);
  });

  it('quantises angles to within a tiny error and wraps them', () => {
    for (const a of [0, 1, -1, Math.PI - 0.001, -Math.PI + 0.001, 7, -7]) {
      const w = new BinaryWriter();
      w.angle16(a);
      const decoded = new BinaryReader(w.finish()).angle16();
      const diff = Math.atan2(Math.sin(decoded - a), Math.cos(decoded - a));
      expect(Math.abs(diff)).toBeLessThan(0.0002);
    }
  });

  it('throws on truncated input instead of reading garbage', () => {
    const r = new BinaryReader(new Uint8Array([1, 2]));
    expect(() => r.u32()).toThrow(BinaryReadError);
  });
});

describe('protocol', () => {
  it('round-trips input batches and quantisation is idempotent', () => {
    const inputs = [
      { seq: 10, moveX: 0.7071, moveY: -0.7071, aim: 2.5, buttons: 5, slot: 2, viewTick: 1234.5 },
      { seq: 11, moveX: 0, moveY: 1, aim: -3, buttons: 0, slot: 255, viewTick: 1234.55 },
    ];
    const bytes = encodeInputs(inputs);
    const r = new BinaryReader(bytes);
    expect(r.u8()).toBe(1);
    const decoded = decodeInputs(r);
    expect(decoded).toHaveLength(2);
    expect(decoded[0].seq).toBe(10);
    expect(decoded[0].slot).toBe(2);
    expect(decoded[1].slot).toBe(255);
    expect(decoded[0].moveX).toBeCloseTo(0.7071, 2);
    expect(decoded[0].viewTick).toBeCloseTo(1234.5, 2);
    const q = quantizeInput(inputs[0]);
    expect(quantizeInput(q)).toEqual(q);
  });

  it('round-trips self state', () => {
    const s = createPlayerSimState(12.25, 40.5);
    s.vx = 1.5;
    s.stamina = 0.42;
    s.exhausted = true;
    s.magAmmo = 13;
    s.slot = 1;
    const w = new BinaryWriter();
    writeSelfState(w, s);
    const back = readSelfState(new BinaryReader(w.finish()))!;
    expect(back.x).toBeCloseTo(12.25);
    expect(back.y).toBeCloseTo(40.5);
    expect(back.vx).toBeCloseTo(1.5);
    expect(back.stamina).toBeCloseTo(0.42, 4);
    expect(back.exhausted).toBe(true);
    expect(back.magAmmo).toBe(13);
    expect(back.slot).toBe(1);
  });

  it('decodes a full snapshot', () => {
    const w = new BinaryWriter();
    w.u32(99).f64(480.5).u32(77);
    writeSelfState(w, null);
    w.varuint(1);
    writeEvent(w, {
      type: NetEventType.Shot,
      shooter: 3,
      item: 7,
      x: 1,
      y: 2,
      pellets: [{ angle: 0.5, distance: 12.34, impact: 1 }],
    });
    const zombie: NetEntity = {
      id: 42,
      kind: EntityKind.Zombie,
      x: 10,
      y: 20,
      angle: 1,
      anim: 2,
      flags: 0,
      item: 0,
      health: 1,
      look: 123456,
      extra: 3,
      name: '',
    };
    w.varuint(1);
    writeSpawn(w, zombie);
    w.varuint(1);
    writeUpdate(w, 42, DeltaBits.Position | DeltaBits.Health, { ...zombie, x: 11, health: 0.5 });
    w.varuint(2).varuint(5).varuint(6);
    const snap = decodeSnapshot(new BinaryReader(w.finish()));
    expect(snap.tick).toBe(99);
    expect(snap.worldMinutes).toBe(480.5);
    expect(snap.ackSeq).toBe(77);
    expect(snap.self).toBeNull();
    expect(snap.events[0]).toMatchObject({ type: NetEventType.Shot, shooter: 3, item: 7 });
    expect(snap.spawns[0]).toMatchObject({ id: 42, kind: EntityKind.Zombie, look: 123456, extra: 3 });
    expect(snap.updates[0]).toMatchObject({ id: 42, x: 11 });
    expect(snap.updates[0].health).toBeCloseTo(0.5, 1);
    expect(snap.updates[0].angle).toBeUndefined();
    expect(snap.despawns).toEqual([5, 6]);
  });
});
