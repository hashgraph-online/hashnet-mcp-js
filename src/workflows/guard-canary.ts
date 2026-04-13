type McpServerDetails = {
  capabilities?: string[];
  connectionInfo?: {
    url?: string;
  };
  tools?: Array<{
    name?: string;
  }>;
};

type RegistrationProfile = {
  mcpServer?: McpServerDetails;
};

export type GuardCanaryRegistration = {
  profile?: RegistrationProfile;
};

export type GuardCanaryDriftSummary = {
  baselineDomain: string | null;
  candidateDomain: string | null;
  domainChanged: boolean;
  addedCapabilities: string[];
  removedCapabilities: string[];
  addedTools: string[];
  removedTools: string[];
  risk: 'safe' | 'review';
};

const normalizeString = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractDomain = (rawUrl: string | undefined): string | null => {
  const normalized = normalizeString(rawUrl);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized).host.toLowerCase();
  } catch {
    return null;
  }
};

const toSortedUniqueList = (values: Array<string | undefined>): string[] =>
  [...new Set(values.map((value) => normalizeString(value)).filter((value): value is string => value !== null))].sort(
    (left, right) => left.localeCompare(right),
  );

const diffLists = (baseline: string[], candidate: string[]) => ({
  added: candidate.filter((value) => !baseline.includes(value)),
  removed: baseline.filter((value) => !candidate.includes(value)),
});

export const summarizeGuardCanaryDrift = (
  baseline: GuardCanaryRegistration,
  candidate: GuardCanaryRegistration,
): GuardCanaryDriftSummary => {
  const baselineMcp = baseline.profile?.mcpServer;
  const candidateMcp = candidate.profile?.mcpServer;
  const baselineDomain = extractDomain(baselineMcp?.connectionInfo?.url);
  const candidateDomain = extractDomain(candidateMcp?.connectionInfo?.url);
  const baselineCapabilities = toSortedUniqueList(baselineMcp?.capabilities ?? []);
  const candidateCapabilities = toSortedUniqueList(candidateMcp?.capabilities ?? []);
  const baselineTools = toSortedUniqueList((baselineMcp?.tools ?? []).map((tool) => tool.name));
  const candidateTools = toSortedUniqueList((candidateMcp?.tools ?? []).map((tool) => tool.name));
  const capabilityDiff = diffLists(baselineCapabilities, candidateCapabilities);
  const toolDiff = diffLists(baselineTools, candidateTools);
  const domainChanged =
    baselineDomain !== null && candidateDomain !== null ? baselineDomain !== candidateDomain : baselineDomain !== candidateDomain;
  return {
    baselineDomain,
    candidateDomain,
    domainChanged,
    addedCapabilities: capabilityDiff.added,
    removedCapabilities: capabilityDiff.removed,
    addedTools: toolDiff.added,
    removedTools: toolDiff.removed,
    risk:
      domainChanged ||
      capabilityDiff.added.length > 0 ||
      capabilityDiff.removed.length > 0 ||
      toolDiff.added.length > 0 ||
      toolDiff.removed.length > 0
        ? 'review'
        : 'safe',
  };
};
