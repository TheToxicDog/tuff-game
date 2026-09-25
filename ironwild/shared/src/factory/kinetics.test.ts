import { describe, expect, it } from 'vitest';
import { structureDef } from '../content/structures';
import { solveKinetics, type KineticBlock } from './kinetics';

let nextId = 1;
const block = (type: string, x: number, y: number, rot = 0, extra: Partial<KineticBlock> = {}): KineticBlock => ({
  id: nextId++,
  def: structureDef(type),
  x,
  y,
  rot,
  active: true,
  ...extra,
});

describe('kinetic networks', () => {
  it('matches the design example: 80 / 100 works, 120 / 100 stalls (§21)', () => {
    // WATER WHEEL ═ SHAFT ═ GEARBOX; crusher north, press south, belts east.
    const wheel = block('water_wheel', 0, 5);
    const shaft = block('shaft', 1, 5);
    const gearbox = block('gearbox', 2, 5);
    const crusher = block('crusher', 2, 4);
    const press = block('press', 2, 6);
    const belts = [{ id: 1, tiles: Array.from({ length: 20 }, (_, i) => ({ x: 3 + i, y: 5 })) }];
    const sol = solveKinetics([wheel, shaft, gearbox, crusher, press], belts);
    const net = sol.networks.get(sol.netOf.get(crusher.id)!)!;
    expect(net.rpm).toBe(16);
    expect(net.capacity).toBe(100);
    expect(net.load).toBe(80);
    expect(net.stalled).toBe(false);
    expect(sol.speeds.get(crusher.id)).toEqual([16]);
    expect(sol.beltSpeed.get(1)).toBe(16);

    // A second crusher on the gearbox's free face (east) overloads it: 40 + 30 + 40 = 110 > 100.
    const crusherEast = block('crusher', 3, 5);
    const sol2 = solveKinetics([wheel, shaft, gearbox, crusher, press, crusherEast]);
    const net2 = sol2.networks.get(sol2.netOf.get(crusher.id)!)!;
    expect(net2.load).toBe(110);
    expect(net2.stalled).toBe(true);
    expect(sol2.speeds.get(crusher.id)).toEqual([0]);
  });

  it('shafts only connect along their axis', () => {
    const wheel = block('water_wheel', 0, 0);
    const vertical = block('shaft', 1, 0, 1); // rot 1: north-south axis
    const sol = solveKinetics([wheel, vertical]);
    expect(sol.netOf.get(wheel.id)).not.toBe(sol.netOf.get(vertical.id));
  });

  it('speed gearboxes double speed and stress beyond them', () => {
    const wheel = block('water_wheel', 0, 0);
    // Speed gearbox rotated so its fast (north) face points east: rot 1.
    const gb = block('speed_gearbox', 1, 0, 1);
    const saw = block('saw', 2, 0);
    const sol = solveKinetics([wheel, gb, saw]);
    expect(sol.speeds.get(saw.id)).toEqual([32]);
    const net = sol.networks.get(sol.netOf.get(saw.id)!)!;
    expect(net.load).toBe(50);
    // Reversed: the fast side faces the wheel, so the saw turns at half speed.
    const gbSlow = block('speed_gearbox', 1, 0, 3);
    const sol2 = solveKinetics([wheel, gbSlow, saw]);
    expect(sol2.speeds.get(saw.id)).toEqual([8]);
    expect(sol2.networks.get(sol2.netOf.get(saw.id)!)!.load).toBe(12.5);
  });

  it('inactive sources provide nothing and the slowest source sets the pace', () => {
    const crank = block('hand_crank', 0, 0, 0, { active: false });
    const shaft = block('shaft', 1, 0);
    const mill = block('millstone', 2, 0);
    let sol = solveKinetics([crank, shaft, mill]);
    expect(sol.speeds.get(mill.id)).toEqual([0]);
    crank.active = true;
    sol = solveKinetics([crank, shaft, mill]);
    // 8 RPM crank: capacity 32 × 8/16 = 16, millstone load 20 × 8/16 = 10.
    const net = sol.networks.get(sol.netOf.get(mill.id)!)!;
    expect(net.capacity).toBe(16);
    expect(net.load).toBe(10);
    expect(sol.speeds.get(mill.id)).toEqual([8]);
  });

  it('flags gear loops with contradicting ratios', () => {
    // wheel → gearbox A → speed gearbox (fast side east) → gearbox B, and a plain loop back to A
    // through three gearboxes on the row above: B would have to turn at 16 and 32 RPM at once.
    const wheel = block('water_wheel', 0, 1);
    const a = block('gearbox', 1, 1);
    const fast = block('speed_gearbox', 2, 1, 1);
    const b = block('gearbox', 3, 1);
    const top1 = block('gearbox', 1, 0);
    const top2 = block('gearbox', 2, 0);
    const top3 = block('gearbox', 3, 0);
    const sol = solveKinetics([wheel, a, fast, b, top1, top2, top3]);
    const net = sol.networks.get(sol.netOf.get(wheel.id)!)!;
    expect(net.conflict).toBe(true);
    expect(sol.speeds.get(b.id)).toEqual([0]);
  });
});
