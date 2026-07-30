import sourceData from "../../data/sources.json";
import exemptionData from "../../data/exemption-codes.json";
import demoData from "../../data/demo-fixtures.json";
import type { ExemptionCode, SourceDefinition } from "../core/types";
import { sourceRegistryDataSchema } from "../core/validation";

const validatedSourceData = sourceRegistryDataSchema.parse(sourceData);

export const sourceRegistry = validatedSourceData.sources as SourceDefinition[];
export const sourceRegistryVersion = validatedSourceData.version;
export const sourceRegistryValidated = validatedSourceData.lastValidated;
export const sourcePolicyStatement = validatedSourceData.policyStatement;
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
