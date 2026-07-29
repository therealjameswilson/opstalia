import sourceData from "../../data/sources.json";
import exemptionData from "../../data/exemption-codes.json";
import demoData from "../../data/demo-fixtures.json";
import type { ExemptionCode, SourceDefinition } from "../core/types";

export const sourceRegistry = sourceData.sources as SourceDefinition[];
export const sourceRegistryVersion = sourceData.version;
export const sourceRegistryValidated = sourceData.lastValidated;
export const sourcePolicyStatement = sourceData.policyStatement;
export const exemptionCodes = exemptionData.codes as ExemptionCode[];
export const exemptionDictionaryVersion = exemptionData.version;
export const exemptionInterpretationWarning = exemptionData.interpretationWarning;
export const demoFixtures = demoData;

export function getSource(sourceId: string): SourceDefinition | undefined {
  return sourceRegistry.find((source) => source.id === sourceId);
}

export function activeSourceCounts(): Record<string, number> {
  return sourceRegistry.reduce<Record<string, number>>((counts, source) => {
    counts[source.adapterStatus] = (counts[source.adapterStatus] ?? 0) + 1;
    return counts;
  }, {});
}
