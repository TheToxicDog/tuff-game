// A small entity-component-system.
//
// Entities are integer ids. Components are plain data objects stored per type in sparse sets
// (dense arrays + id -> index map) so iteration stays cache-friendly and removal is O(1).
// Systems are ordinary functions that query the world; the ECS itself imposes no scheduling.

export type Entity = number;

let nextComponentTypeId = 0;

/** A typed handle that identifies one kind of component. */
export class ComponentType<T> {
  readonly id = nextComponentTypeId++;
  /** Phantom field so `ComponentType<A>` and `ComponentType<B>` are not interchangeable. */
  declare readonly __type?: T;

  constructor(readonly name: string) {}
}

export function defineComponent<T>(name: string): ComponentType<T> {
  return new ComponentType<T>(name);
}

class ComponentStore<T> {
  readonly dense: T[] = [];
  readonly entities: Entity[] = [];
  private readonly index = new Map<Entity, number>();

  get size(): number {
    return this.entities.length;
  }

  has(entity: Entity): boolean {
    return this.index.has(entity);
  }

  get(entity: Entity): T | undefined {
    const i = this.index.get(entity);
    return i === undefined ? undefined : this.dense[i];
  }

  set(entity: Entity, value: T): void {
    const i = this.index.get(entity);
    if (i !== undefined) {
      this.dense[i] = value;
      return;
    }
    this.index.set(entity, this.entities.length);
    this.entities.push(entity);
    this.dense.push(value);
  }

  delete(entity: Entity): boolean {
    const i = this.index.get(entity);
    if (i === undefined) return false;
    const last = this.entities.length - 1;
    if (i !== last) {
      const movedEntity = this.entities[last];
      this.entities[i] = movedEntity;
      this.dense[i] = this.dense[last];
      this.index.set(movedEntity, i);
    }
    this.entities.pop();
    this.dense.pop();
    this.index.delete(entity);
    return true;
  }
}

export class World {
  private nextEntity = 1;
  private readonly alive = new Set<Entity>();
  private readonly stores: ComponentStore<unknown>[] = [];
  private readonly destroyListeners: ((entity: Entity) => void)[] = [];

  /**
   * Entity ids are never reused during a server's lifetime. They are replicated to clients, and
   * reusing them could make a client confuse a new entity with a stale one.
   */
  create(): Entity {
    const entity = this.nextEntity++;
    this.alive.add(entity);
    return entity;
  }

  isAlive(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  onDestroy(listener: (entity: Entity) => void): void {
    this.destroyListeners.push(listener);
  }

  destroy(entity: Entity): void {
    if (!this.alive.has(entity)) return;
    for (const listener of this.destroyListeners) listener(entity);
    for (const store of this.stores) store?.delete(entity);
    this.alive.delete(entity);
  }

  private store<T>(type: ComponentType<T>): ComponentStore<T> {
    let store = this.stores[type.id] as ComponentStore<T> | undefined;
    if (!store) {
      store = new ComponentStore<T>();
      this.stores[type.id] = store as ComponentStore<unknown>;
    }
    return store;
  }

  add<T>(entity: Entity, type: ComponentType<T>, value: T): T {
    if (!this.alive.has(entity)) throw new Error(`Cannot add ${type.name} to dead entity ${entity}`);
    this.store(type).set(entity, value);
    return value;
  }

  get<T>(entity: Entity, type: ComponentType<T>): T | undefined {
    return this.store(type).get(entity);
  }

  /** Like `get`, but throws when the component is missing. */
  req<T>(entity: Entity, type: ComponentType<T>): T {
    const value = this.store(type).get(entity);
    if (value === undefined) throw new Error(`Entity ${entity} has no ${type.name}`);
    return value;
  }

  has(entity: Entity, type: ComponentType<unknown>): boolean {
    return this.store(type).has(entity);
  }

  remove(entity: Entity, type: ComponentType<unknown>): void {
    this.store(type).delete(entity);
  }

  count(type: ComponentType<unknown>): number {
    return this.store(type).size;
  }

  /**
   * Returns a snapshot of all entities that have every listed component. The snapshot is safe to
   * iterate while systems create or destroy entities.
   */
  query(...types: ComponentType<unknown>[]): Entity[] {
    if (types.length === 0) return [...this.alive];
    let smallest = this.store(types[0]);
    for (let i = 1; i < types.length; i++) {
      const s = this.store(types[i]);
      if (s.size < smallest.size) smallest = s;
    }
    const result: Entity[] = [];
    outer: for (const entity of smallest.entities) {
      for (const type of types) {
        if (!this.store(type).has(entity)) continue outer;
      }
      result.push(entity);
    }
    return result;
  }

  /** Iterates entities with a single component type without allocating a snapshot. */
  each<T>(type: ComponentType<T>, fn: (entity: Entity, value: T) => void): void {
    const store = this.store(type);
    // Iterate backwards so the callback may remove the current entity safely.
    for (let i = store.entities.length - 1; i >= 0; i--) {
      if (i >= store.entities.length) continue;
      fn(store.entities[i], store.dense[i]);
    }
  }
}
