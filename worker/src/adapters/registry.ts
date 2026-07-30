import type { SourceAdapter } from "./types";
import { GovInfoAdapter, type GovInfoAdapterEnvironment } from "./govinfo";
import {
  NARA_DISCOVERY_PROFILES,
  NaraAdapter,
  type NaraAdapterEnvironment,
  type NaraDiscoveryProfileId
} from "./nara";
import { NtrsAdapter } from "./ntrs";
import { OstiAdapter } from "./osti";

export type WorkerSourceId =
  | NaraDiscoveryProfileId
  | "govinfo"
  | "nasa-ntrs"
  | "osti-sti";

export interface WorkerAdapterEnvironment
  extends NaraAdapterEnvironment,
    GovInfoAdapterEnvironment {}

type AdapterFactory = (environment: WorkerAdapterEnvironment) => SourceAdapter<unknown>;

const factories: Record<WorkerSourceId, AdapterFactory> = {
  nara: (environment) =>
    new NaraAdapter(environment, NARA_DISCOVERY_PROFILES.nara) as SourceAdapter<unknown>,
  "nara-cia-rg263": (environment) =>
    new NaraAdapter(environment, NARA_DISCOVERY_PROFILES["nara-cia-rg263"]) as SourceAdapter<unknown>,
  "nara-state-rg59": (environment) =>
    new NaraAdapter(environment, NARA_DISCOVERY_PROFILES["nara-state-rg59"]) as SourceAdapter<unknown>,
  govinfo: (environment) => new GovInfoAdapter(environment) as SourceAdapter<unknown>,
  "nasa-ntrs": () => new NtrsAdapter() as SourceAdapter<unknown>,
  "osti-sti": () => new OstiAdapter() as SourceAdapter<unknown>
};

export const workerSourceIds = Object.freeze(Object.keys(factories) as WorkerSourceId[]);

export function isWorkerSourceId(value: string): value is WorkerSourceId {
  return Object.hasOwn(factories, value);
}

export function createWorkerAdapter(
  sourceId: WorkerSourceId,
  environment: WorkerAdapterEnvironment
): SourceAdapter<unknown> {
  return factories[sourceId](environment);
}
