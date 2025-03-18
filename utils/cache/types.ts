import type { SimulationData } from '../../types';

export interface CachedProposalEvent {
  startBlock: string;
  endBlock: string;
  id: string;
  proposalId: string;
  values: string[];
  targets: string[];
  proposer: string;
  description: string;
  signatures: string[];
  calldatas: string[];
}

export interface CachedSimulationData {
  proposal: CachedProposalEvent;
  config: SimulationData['config'];
  sim: SimulationData['sim'];
  deps: SimulationData['deps'];
  latestBlock: SimulationData['latestBlock'];
}

export interface ProposalCacheEntry {
  timestamp: number;
  proposalState: string | null;
  simulationData: CachedSimulationData;
}

export type NeedsSimulationParams = {
  daoName: string;
  governorAddress: string;
  proposalId: string;
  currentState: string | null;
};
