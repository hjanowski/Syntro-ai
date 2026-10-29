import type {
  AttributionResult,
  CollectedEvent,
  CollectorLogEntry,
  ExecutionLogEntry,
  JourneyDefinition,
  LedgerEntry,
  PlatformRecord,
  PreflightReport,
  Project,
  Scenario,
  SimulationRun,
  SyntheticCustomer,
  ValidationReport,
} from '../domain/types.ts';

export interface Collection<T extends { id: string }> {
  get(id: string): T | undefined;
  put(item: T): T;
  delete(id: string): boolean;
  list(filter?: (item: T) => boolean): T[];
  count(filter?: (item: T) => boolean): number;
  clear(): void;
}

export interface StoreCollections {
  projects: Project;
  journeys: JourneyDefinition;
  scenarios: Scenario;
  runs: SimulationRun;
  customers: SyntheticCustomer;
  ledger: LedgerEntry;
  events: CollectedEvent;
  collectorLog: CollectorLogEntry;
  platformRecords: PlatformRecord;
  attributionResults: AttributionResult;
  validationReports: ValidationReport;
  logs: ExecutionLogEntry;
  preflights: PreflightReport;
}

export type CollectionName = keyof StoreCollections;

export const COLLECTION_NAMES: CollectionName[] = [
  'projects',
  'journeys',
  'scenarios',
  'runs',
  'customers',
  'ledger',
  'events',
  'collectorLog',
  'platformRecords',
  'attributionResults',
  'validationReports',
  'logs',
  'preflights',
];

export type StoreSnapshot = { [K in CollectionName]?: StoreCollections[K][] };

export type Store = { [K in CollectionName]: Collection<StoreCollections[K]> } & {
  snapshot(names?: CollectionName[]): StoreSnapshot;
  load(snapshot: StoreSnapshot): void;
  onChange(listener: (name: CollectionName) => void): () => void;
  resetAll(): void;
};

class MemoryCollection<T extends { id: string }> implements Collection<T> {
  private items = new Map<string, T>();

  constructor(
    private readonly name: CollectionName,
    private readonly notify: (name: CollectionName) => void,
  ) {}

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  put(item: T): T {
    this.items.set(item.id, item);
    this.notify(this.name);
    return item;
  }

  delete(id: string): boolean {
    const existed = this.items.delete(id);
    if (existed) this.notify(this.name);
    return existed;
  }

  list(filter?: (item: T) => boolean): T[] {
    const all = Array.from(this.items.values());
    return filter ? all.filter(filter) : all;
  }

  count(filter?: (item: T) => boolean): number {
    return filter ? this.list(filter).length : this.items.size;
  }

  clear(): void {
    this.items.clear();
    this.notify(this.name);
  }

  /** @internal */
  loadAll(items: T[]): void {
    this.items.clear();
    for (const item of items) this.items.set(item.id, item);
  }
}

/**
 * In-memory store with change notifications. Hosts attach persistence
 * (JSON files in Node, localStorage in the browser) through `onChange` + `snapshot`.
 * A PostgreSQL implementation of `Store` is the intended production path.
 */
export class MemoryStore implements Store {
  private listeners = new Set<(name: CollectionName) => void>();
  private suspended = false;

  projects!: Collection<Project>;
  journeys!: Collection<JourneyDefinition>;
  scenarios!: Collection<Scenario>;
  runs!: Collection<SimulationRun>;
  customers!: Collection<SyntheticCustomer>;
  ledger!: Collection<LedgerEntry>;
  events!: Collection<CollectedEvent>;
  collectorLog!: Collection<CollectorLogEntry>;
  platformRecords!: Collection<PlatformRecord>;
  attributionResults!: Collection<AttributionResult>;
  validationReports!: Collection<ValidationReport>;
  logs!: Collection<ExecutionLogEntry>;
  preflights!: Collection<PreflightReport>;

  constructor() {
    for (const name of COLLECTION_NAMES) {
      (this as unknown as Record<CollectionName, unknown>)[name] = new MemoryCollection(name, (n) => this.emit(n));
    }
  }

  private emit(name: CollectionName): void {
    if (this.suspended) return;
    for (const listener of this.listeners) listener(name);
  }

  onChange(listener: (name: CollectionName) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(names: CollectionName[] = COLLECTION_NAMES): StoreSnapshot {
    const out: StoreSnapshot = {};
    for (const name of names) {
      (out as Record<string, unknown>)[name] = this[name].list();
    }
    return out;
  }

  load(snapshot: StoreSnapshot): void {
    this.suspended = true;
    try {
      for (const name of COLLECTION_NAMES) {
        const items = snapshot[name];
        if (items) (this[name] as unknown as MemoryCollection<{ id: string }>).loadAll(items as { id: string }[]);
      }
    } finally {
      this.suspended = false;
    }
  }

  resetAll(): void {
    this.suspended = true;
    for (const name of COLLECTION_NAMES) this[name].clear();
    this.suspended = false;
    for (const name of COLLECTION_NAMES) this.emit(name);
  }
}
