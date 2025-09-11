import mftch from 'micro-ftch';
import type { FETCH_OPT } from 'micro-ftch';
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  toBytes,
  toHex,
  zeroHash,
} from 'viem';
import type {
  GovernorType,
  ProposalData,
  ProposalEvent,
  SimulationBlock,
  SimulationConfig,
  SimulationConfigExecuted,
  SimulationConfigNew,
  SimulationConfigProposed,
  SimulationResult,
  StorageEncodingResponse,
  TenderlyContract,
  TenderlyPayload,
  TenderlySimulation,
} from '../../types.d';
import { GOVERNOR_ABI } from '../abis/GovernorBravo';
import { parseArbitrumL1L2Messages } from '../bridges/arbitrum';
import { parseOptimismL1L2Messages } from '../bridges/optimism';
import {
  BLOCK_GAS_LIMIT,
  TENDERLY_ACCESS_TOKEN,
  TENDERLY_BASE_URL,
  TENDERLY_ENCODE_URL,
  TENDERLY_SIM_URL,
} from '../constants';
import { GOVERNOR_OZ_ABI } from '../constants/abi';
import { fetchTokenMetadata } from '../contracts/erc20';
import {
  generateProposalId,
  getGovernor,
  getProposal,
  getTimelock,
  getVotingToken,
  hashOperationBatchOz,
  hashOperationOz,
} from '../contracts/governor';
import { getChainConfig, publicClient } from './client';

const fetchUrl = mftch;

const TENDERLY_FETCH_OPTIONS = {
  type: 'json' as const,
  headers: { 'X-Access-Key': TENDERLY_ACCESS_TOKEN },
};

// Placeholder sender for simulations.
// IMPORTANT: This MUST remain an empty EOA on mainnet (no code, nonce = 0).
// The test at tests/placeholder-constant.test.ts enforces this invariant.
export const DEFAULT_SIMULATION_ADDRESS = '0x0000000000000000000000000000000000001234' as Address;

type TenderlyError = {
  statusCode?: number;
};

type StateOverridesPayload = {
  networkID: string;
  stateOverrides: Record<string, { value: Record<string, string> }>;
};

interface GovernorOverrideParams {
  governorType: GovernorType;
  proposalId: bigint;
  votingTokenSupply: bigint;
  eta: bigint;
  simBlock: bigint;
  // For new proposals only
  targets?: readonly `0x${string}`[];
  values?: readonly bigint[];
  signatures?: readonly `0x${string}`[];
  calldatas?: readonly `0x${string}`[];
  description?: string;
  proposal?: ProposalEvent;
}

interface SimulationPayloadParams {
  governorType: GovernorType;
  // biome-ignore lint/suspicious/noExplicitAny: Complex contract types that vary by governor type
  governor: any; // Governor contract
  // biome-ignore lint/suspicious/noExplicitAny: Complex contract types that vary by governor type
  timelock: any; // Timelock contract
  from: Address;
  latestBlock: SimulationBlock;
  simBlock: bigint;
  simTimestamp: bigint;
  storageObj: StorageEncodingResponse;
  executeInputs: unknown[];
  saveIfFails?: boolean;
}

// --- Simulation methods ---

/**
 * @notice Simulates a proposal based on the provided configuration
 * @param config Configuration object
 */
export async function simulate(config: SimulationConfig) {
  if (config.type === 'executed') return await simulateExecuted(config);
  if (config.type === 'proposed') return await simulateProposed(config);
  return await simulateNew(config);
}

/**
 * @notice Simulates execution of an on-chain proposal that has not yet been executed
 * @param config Configuration object
 */
export async function simulateNew(config: SimulationConfigNew): Promise<SimulationResult> {
  // --- Validate config ---
  const { governorAddress, governorType, targets, values, signatures, calldatas, description } =
    config;
  if (targets.length !== values.length)
    throw new Error('targets and values must be the same length');
  if (targets.length !== signatures.length)
    throw new Error('targets and signatures must be the same length');
  if (targets.length !== calldatas.length)
    throw new Error('targets and calldatas must be the same length');

  // --- Get details about the proposal we're simulating ---
  const chainId = await publicClient.getChainId();
  const blockNumberToUse = (await getLatestBlock(chainId)) - 3; // subtracting a few blocks to ensure tenderly has the block
  const latestBlock = await publicClient.getBlock({ blockNumber: BigInt(blockNumberToUse) });
  const governor = getGovernor(governorType, governorAddress);
  const timelock = await getTimelock(governorType, governorAddress);
  const proposalId = await generateProposalId(governorType, governorAddress, {
    targets,
    values,
    calldatas,
    description,
  });

  const startBlock = latestBlock.number - 100n; // arbitrarily subtract 100
  const proposal: ProposalEvent = {
    id: proposalId, // Bravo governor
    proposalId, // OZ governor (for simplicity we just include both ID formats)
    proposer: DEFAULT_SIMULATION_ADDRESS,
    startBlock,
    endBlock: startBlock + 1n,
    description,
    targets,
    values,
    signatures,
    calldatas,
  };

  // --- Prepare simulation configuration ---
  // Get voting token and total supply
  const votingToken = await getVotingToken(governorType, governorAddress, proposalId);
  const votingTokenSupply = await votingToken.read.totalSupply(); // used to manipulate vote count

  // Set `from` arbitrarily.
  const from = DEFAULT_SIMULATION_ADDRESS;

  // Run simulation at a recent block rather than using artificial proposal.endBlock
  // This ensures we use current contract state and avoid potential cross-chain conflicts
  const simBlock = latestBlock.number;

  // For OZ governors we arbitrarily choose execution time. For Bravo governors, we
  // compute the approximate earliest possible execution time based on governance parameters. This
  // can only be approximate because voting period is defined in blocks, not as a timestamp. We
  // assume 12 second block times to prefer underestimating timestamp rather than overestimating,
  // and we prefer underestimating to avoid simulations reverting in cases where governance
  // proposals call methods that pass in a start timestamp that must be lower than the current
  // block timestamp (represented by the `simTimestamp` variable below)
  const simTimestamp =
    governorType === 'bravo'
      ? latestBlock.timestamp + (simBlock - (proposal.endBlock ?? latestBlock.number)) * 12n
      : latestBlock.timestamp + 1n;
  const eta = simTimestamp; // set proposal eta to be equal to the timestamp we simulate at

  // Compute transaction hashes used by the Timelock
  const txHashes = computeTransactionHashes(targets, values, signatures, calldatas, eta);

  // Generate the state object needed to mark the transactions as queued in the Timelock's storage
  const timelockStorageObj: Record<string, string> = {};
  for (const hash of txHashes) {
    timelockStorageObj[`queuedTransactions[${hash}]`] = 'true';
  }

  if (governorType === 'oz') {
    const id = hashOperationBatchOz(
      [...targets],
      [...values],
      [...calldatas],
      zeroHash,
      keccak256(toBytes(description)),
    );
    timelockStorageObj[`_timestamps[${toHex(id)}]`] = simTimestamp.toString();
  }

  // Use the Tenderly API to get the encoded state overrides for governor storage
  const governorStateOverrides = buildGovernorStateOverrides({
    governorType,
    proposalId,
    votingTokenSupply,
    eta,
    simBlock,
    targets,
    values,
    signatures,
    calldatas,
    description,
    proposal,
  });

  const stateOverrides: StateOverridesPayload = {
    networkID: '1',
    stateOverrides: {
      [timelock.address]: {
        value: timelockStorageObj,
      },
      [governor.address]: {
        value: governorStateOverrides,
      },
    },
  };

  const storageObj = await sendEncodeRequest(stateOverrides);

  // --- Simulate it ---
  // We need the following state conditions to be true to successfully simulate a proposal:
  //   - proposalCount >= proposal.id
  //   - proposal.canceled == false
  //   - proposal.executed == false
  //   - block.number > proposal.endBlock
  //   - proposal.forVotes > proposal.againstVotes
  //   - proposal.forVotes > quorumVotes
  //   - proposal.eta !== 0
  //   - block.timestamp >= proposal.eta
  //   - block.timestamp <  proposal.eta + timelock.GRACE_PERIOD()
  //   - queuedTransactions[txHash] = true for each action in the proposal
  const descriptionHash = keccak256(toBytes(description));
  const executeInputs =
    governorType === 'bravo' ? [proposalId] : [targets, values, calldatas, descriptionHash];

  const simulationPayload = buildSimulationPayload({
    governorType,
    governor,
    timelock,
    from,
    latestBlock,
    simBlock,
    simTimestamp,
    storageObj,
    executeInputs,
    saveIfFails: false,
  });

  // Handle ETH transfers if needed
  handleETHValueRequirements(simulationPayload, config.values, from, timelock.address);

  // Run the simulation
  const sim = await sendSimulation(simulationPayload);

  const deps: ProposalData = {
    governor,
    timelock,
    publicClient,
    chainConfig: getChainConfig(1), // Mainnet chain config
    targets: targets.map((target: string) => target),
    touchedContracts: sim.contracts.map((contract) => contract.address),
  };

  // For new proposals, use simulation timing as created timing since they don't exist on-chain yet
  const proposalCreatedBlock = latestBlock;

  return { sim, proposal, latestBlock, deps, proposalCreatedBlock };
}

/**
 * @notice Simulates execution of an on-chain proposal that has not yet been executed
 * @param config Configuration object
 */
async function simulateProposed(config: SimulationConfigProposed): Promise<SimulationResult> {
  const { governorAddress, governorType, proposalId } = config;

  // --- Get details about the proposal we're simulating ---
  const chainId = await publicClient.getChainId();
  const blockNumberToUse = (await getLatestBlock(chainId)) - 3; // subtracting a few blocks to ensure tenderly has the block
  const latestBlock = await publicClient.getBlock({ blockNumber: BigInt(blockNumberToUse) });
  const blockRange = [0n, latestBlock.number];
  const governor = getGovernor(governorType, governorAddress);
  const timelock = await getTimelock(governorType, governorAddress);
  const proposal = await getProposal(governorType, governorAddress, proposalId);
  const abi = governorType === 'bravo' ? GOVERNOR_ABI : GOVERNOR_OZ_ABI;

  const proposalCreatedEvents = await publicClient.getContractEvents({
    address: governorAddress,
    abi,
    eventName: 'ProposalCreated',
    fromBlock: blockRange[0],
    toBlock: blockRange[1],
  });

  const proposalCreatedEvent = proposalCreatedEvents.filter((e) => {
    const args = e.args;
    if (governorType === 'bravo' && 'id' in args) {
      return args.id === proposalId;
    }
    if (governorType === 'oz' && 'proposalId' in args) {
      return args.proposalId === proposalId;
    }
    return false;
  })[0];
  if (!proposalCreatedEvent)
    throw new Error(`Proposal creation log for #${proposalId} not found in governor logs`);
  const { targets, signatures: sigs, calldatas, description, values } = proposalCreatedEvent.args;
  if (!targets || !values || !sigs || !calldatas || !description) {
    throw new Error('Missing required proposal data in creation event');
  }

  // --- Prepare simulation configuration ---
  // We need the following state conditions to be true to successfully simulate a proposal:
  //   - proposal.canceled == false
  //   - proposal.executed == false
  //   - block.number > proposal.endBlock
  //   - proposal.forVotes > proposal.againstVotes
  //   - proposal.forVotes > quorumVotes
  //   - proposal.eta !== 0
  //   - block.timestamp >= proposal.eta
  //   - block.timestamp <  proposal.eta + timelock.GRACE_PERIOD()
  //   - queuedTransactions[txHash] = true for each action in the proposal

  // Get voting token and total supply
  const votingToken = await getVotingToken(governorType, governorAddress, proposal.id);
  const votingTokenSupply = await votingToken.read.totalSupply(); // used to manipulate vote count

  // Set `from` arbitrarily.
  const from = DEFAULT_SIMULATION_ADDRESS;

  // For Bravo governors, we use the block right after the proposal ends, and for OZ
  // governors we arbitrarily use the next block number.
  const simBlock =
    governorType === 'bravo'
      ? (proposal.endBlock ?? latestBlock.number) + 1n
      : latestBlock.number + 1n;

  // For OZ governors we are given the earliest possible execution time. For Bravo governors, we
  // Compute the approximate earliest possible execution time based on governance parameters. This
  // can only be approximate because voting period is defined in blocks, not as a timestamp. We
  // assume 12 second block times to prefer underestimating timestamp rather than overestimating,
  // and we prefer underestimating to avoid simulations reverting in cases where governance
  // proposals call methods that pass in a start timestamp that must be lower than the current
  // block timestamp (represented by the `simTimestamp` variable below)
  const simTimestamp =
    governorType === 'bravo'
      ? latestBlock.timestamp + (simBlock - (proposal.endBlock ?? latestBlock.number)) * 12n
      : latestBlock.timestamp + 1n;
  const eta = simTimestamp; // set proposal eta to be equal to the timestamp we simulate at

  // Compute transaction hashes used by the Timelock
  const txHashes = computeTransactionHashes(
    targets as readonly `0x${string}`[],
    values,
    sigs as readonly `0x${string}`[],
    calldatas as readonly `0x${string}`[],
    eta,
  );

  // Generate the state object needed to mark the transactions as queued in the Timelock's storage
  const timelockStorageObj: Record<string, string> = {};
  for (const hash of txHashes) {
    timelockStorageObj[`queuedTransactions[${hash}]`] = 'true';
  }

  if (governorType === 'oz') {
    const id = hashOperationBatchOz(
      [...targets],
      [...values],
      [...calldatas],
      zeroHash,
      keccak256(toBytes(description)),
    );
    timelockStorageObj[`_timestamps[${toHex(id)}]`] = simTimestamp.toString();
  }

  const governorStateOverrides = buildGovernorStateOverrides({
    governorType,
    proposalId,
    votingTokenSupply,
    eta,
    simBlock,
    // No targets/values/signatures/calldatas for existing proposals
  });

  const stateOverrides: StateOverridesPayload = {
    networkID: '1',
    stateOverrides: {
      [timelock.address]: {
        value: timelockStorageObj,
      },
      [governor.address]: {
        value: governorStateOverrides,
      },
    },
  };
  const storageObj = await sendEncodeRequest(stateOverrides);

  // --- Simulate it ---
  // Note: The Tenderly API is sensitive to the input types, so all formatting below (e.g. stripping
  // leading zeroes, padding with zeros, strings vs. hex, etc.) are all intentional decisions to
  // ensure Tenderly properly parses the simulation payload
  const descriptionHash = keccak256(toBytes(description));
  const executeInputs =
    governorType === 'bravo' ? [proposalId] : [targets, values, calldatas, descriptionHash];

  const simulationPayload = buildSimulationPayload({
    governorType,
    governor,
    timelock,
    from,
    latestBlock,
    simBlock,
    simTimestamp,
    storageObj,
    executeInputs,
    saveIfFails: true, // Different for proposed
  });

  const formattedProposal: ProposalEvent = {
    id: proposalId,
    proposalId,
    proposer: proposalCreatedEvent.args.proposer ?? DEFAULT_SIMULATION_ADDRESS,
    startBlock: proposalCreatedEvent.args.startBlock ?? 0n,
    endBlock: proposalCreatedEvent.args.endBlock ?? 0n,
    description: proposalCreatedEvent.args.description ?? '',
    targets: [...(proposalCreatedEvent.args.targets ?? [])],
    values: [...values],
    signatures: [...(proposalCreatedEvent.args.signatures ?? [])],
    calldatas: [...(proposalCreatedEvent.args.calldatas ?? [])],
  };

  // Handle ETH transfers if needed
  handleETHValueRequirements(simulationPayload, values, from, timelock.address);

  // Run the simulation
  const sim = await sendSimulation(simulationPayload);

  const deps: ProposalData = {
    governor,
    timelock,
    publicClient,
    chainConfig: getChainConfig(1), // Mainnet chain config
    targets: proposalCreatedEvent.args.targets?.map((target: string) => target) ?? [],
    touchedContracts: sim.contracts.map((contract) => contract.address),
  };

  // Get block details for proposal creation timing
  const proposalCreatedBlock = await publicClient.getBlock({
    blockNumber: proposalCreatedEvent.blockNumber,
  });

  return { sim, proposal: formattedProposal, latestBlock, deps, proposalCreatedBlock };
}

/**
 * @notice Simulates execution of an already-executed governance proposal
 * @param config Configuration object
 */
async function simulateExecuted(config: SimulationConfigExecuted): Promise<SimulationResult> {
  const { governorAddress, governorType, proposalId } = config;

  // --- Get details about the proposal we're analyzing ---
  const latestBlockNumber = await publicClient.getBlockNumber();
  const latestBlock = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNumber) });
  const blockRange = [0n, latestBlock.number];
  const governor = getGovernor(governorType, governorAddress);
  const timelock = await getTimelock(governorType, governorAddress);

  const [createProposalEvents, proposalExecutedEvents] = await Promise.all([
    publicClient.getContractEvents({
      address: governorAddress,
      abi: governor.abi,
      eventName: 'ProposalCreated',
      fromBlock: blockRange[0],
      toBlock: blockRange[1],
    }),
    publicClient.getContractEvents({
      address: governorAddress,
      abi: governor.abi,
      eventName: 'ProposalExecuted',
      fromBlock: blockRange[0],
      toBlock: blockRange[1],
    }),
  ]);

  const proposalCreatedEvent = createProposalEvents.filter((e) => {
    const args = e.args;
    if (governorType === 'bravo' && 'id' in args) {
      return args.id === proposalId;
    }
    if (governorType === 'oz' && 'proposalId' in args) {
      return args.proposalId === proposalId;
    }
  })[0];

  const proposal = proposalCreatedEvent.args;

  const proposalExecutedEvent = proposalExecutedEvents.filter((e) => {
    const args = e.args;
    if (governorType === 'bravo' && 'id' in args) {
      return args.id === proposalId;
    }
    if (governorType === 'oz' && 'proposalId' in args) {
      return args.proposalId === proposalId;
    }
  })[0];

  // --- Simulate it ---
  // Prepare tenderly payload. Since this proposal was already executed, we directly use that transaction data
  const tx = await publicClient.getTransaction({ hash: proposalExecutedEvent.transactionHash });
  const simulationPayload: TenderlyPayload = {
    network_id: String(tx.chainId) as TenderlyPayload['network_id'],
    block_number: Number(tx.blockNumber),
    from: tx.from,
    to: tx.to ?? '',
    input: tx.input,
    gas: Number(tx.gas),
    gas_price: tx.gasPrice?.toString(),
    value: tx.value.toString(),
    save_if_fails: false, // Set to true to save the simulation to your Tenderly dashboard if it fails.
    save: false, // Set to true to save the simulation to your Tenderly dashboard if it succeeds.
    generate_access_list: true,
  };
  const sim = await sendSimulation(simulationPayload);

  // Validate required fields
  if (!proposal.proposer) {
    throw new Error(`Missing proposer in ProposalCreated event for proposal ${proposalId}`);
  }
  if (!proposal.description) {
    throw new Error(`Missing description in ProposalCreated event for proposal ${proposalId}`);
  }

  const formattedProposal: ProposalEvent = {
    ...proposal,
    id: proposalId,
    proposalId: proposalId,
    proposer: proposal.proposer, // Required field, validated above
    description: proposal.description, // Required field, validated above
    targets: [...(proposal.targets ?? [])],
    values: [...(proposal.values ?? [])],
    signatures: [...(proposal.signatures ?? [])],
    calldatas: [...(proposal.calldatas ?? [])],
    startBlock: proposal.startBlock ?? 0n,
    endBlock: proposal.endBlock ?? 0n,
  };
  const deps: ProposalData = {
    governor,
    timelock,
    publicClient,
    chainConfig: getChainConfig(1), // Mainnet chain config
    targets: proposalCreatedEvent.args.targets?.map((target: string) => target) ?? [],
    touchedContracts: sim.contracts.map((contract) => contract.address),
  };

  // Get block details for proposal creation and execution timing
  const [proposalCreatedBlock, proposalExecutedBlock] = await Promise.all([
    publicClient.getBlock({ blockNumber: proposalCreatedEvent.blockNumber }),
    publicClient.getBlock({ blockNumber: proposalExecutedEvent.blockNumber }),
  ]);

  return {
    sim,
    proposal: formattedProposal,
    latestBlock,
    deps,
    executor: tx.from,
    proposalCreatedBlock,
    proposalExecutedBlock,
  };
}

/**
 * @notice Takes a completed source simulation result and handles parsing for
 *         cross-chain messages and executing destination simulations.
 * @param sourceResult The result of the source chain simulation.
 * @returns The potentially augmented SimulationResult including destination sim info.
 */
export async function handleCrossChainSimulations(
  sourceResult: SimulationResult,
): Promise<SimulationResult> {
  const result = {
    ...sourceResult,
    destinationSimulations: sourceResult.destinationSimulations ?? [],
    crossChainFailure: sourceResult.crossChainFailure ?? false,
  };

  if (!result.sim.transaction.status) {
    console.log('[CrossChainHandler] Source simulation failed, skipping destination checks.');
    return result;
  }

  // 1. Parse source simulation for cross-chain messages
  console.log('[CrossChainHandler] Parsing source sim for messages...');

  // Parse messages from both Arbitrum and Optimism bridges
  const arbMessages = parseArbitrumL1L2Messages(result.sim);
  const opMessages = parseOptimismL1L2Messages(result.sim);
  const extractedMessages = [...arbMessages, ...opMessages];

  if (extractedMessages.length === 0) {
    console.log('[CrossChainHandler] No cross-chain messages detected.');
    return result; // Return early with original source data
  }

  // 2. If messages found, simulate them on destination chains
  console.log(
    `[CrossChainHandler] Detected ${extractedMessages.length} messages. Simulating destinations...`,
  );

  const destinationResults = await Promise.all(
    extractedMessages.map(async (message) => {
      const chainId = Number(message.destinationChainId);
      console.log(`[CrossChainHandler] Simulating L2 message to: ${message.l2TargetAddress}`);
      
      // Check if Tenderly supports this network
      if (!isTenderlySupportedNetwork(chainId)) {
        console.warn(
          `[CrossChainHandler] Network ${chainId} is not supported by Tenderly, skipping simulation for target: ${message.l2TargetAddress}`
        );
        return {
          chainId,
          bridgeType: message.bridgeType,
          status: 'skipped' as const,
          error: `Network ${chainId} not supported by Tenderly simulation API`,
          l2Params: message,
        };
      }
      
      try {
        const destinationPayload: TenderlyPayload = {
          network_id: message.destinationChainId.toString() as TenderlyPayload['network_id'],
          from: message.l2FromAddress ?? DEFAULT_SIMULATION_ADDRESS,
          to: message.l2TargetAddress,
          input: message.l2InputData,
          gas: BLOCK_GAS_LIMIT,
          gas_price: '0',
          value: message.l2Value,
          save_if_fails: true,
          save: false,
        };

        // Log the payload before sending
        console.log(
          `[CrossChainHandler] Sending L2 Simulation Payload (Chain ${destinationPayload.network_id}):`,
          JSON.stringify(destinationPayload, null, 2),
        );

        const destSim = await sendSimulation(destinationPayload);

        if (destSim.transaction.status) {
          console.log(
            `[CrossChainHandler] Destination sim SUCCESS for L2 target: ${message.l2TargetAddress}`,
          );
          return {
            chainId: Number(message.destinationChainId),
            bridgeType: message.bridgeType,
            status: 'success' as const,
            sim: destSim,
            l2Params: message,
          };
        }
        console.error(
          `[CrossChainHandler] Destination sim FAILED for L2 target: ${message.l2TargetAddress}`,
        );
        const errorMsg = destSim.transaction?.transaction_info?.call_trace?.error_reason;
        return {
          chainId: Number(message.destinationChainId),
          bridgeType: message.bridgeType,
          status: 'failure' as const,
          error: errorMsg,
          sim: destSim,
          l2Params: message,
        };
      } catch (error: unknown) {
        console.error(
          `[CrossChainHandler] Error during destination simulation API call for L2 target ${message.l2TargetAddress}:`,
          (error as Error).message
        );
        return {
          chainId: Number(message.destinationChainId),
          bridgeType: message.bridgeType,
          status: 'failure' as const,
          error: `Simulation API call failed: ${(error as Error).message}`,
          l2Params: message,
        };
      }
    }),
  );

  result.destinationSimulations = destinationResults;
  result.crossChainFailure = destinationResults.some((res) => res.status === 'failure');

  return result;
}

// --- Helper methods ---

/**
 * @notice Check if a network is supported by Tenderly for simulation
 * @param chainId The chain ID to check
 * @returns true if the network is supported by Tenderly
 */
function isTenderlySupportedNetwork(chainId: number): boolean {
  const supportedNetworks = ['1', '3', '4', '5', '42', '42161', '10', '8453'];
  return supportedNetworks.includes(chainId.toString());
}

/**
 * @notice Handles ETH value requirements for simulation payloads
 * @param simulationPayload The simulation payload to modify
 * @param values Array of ETH values to send with each transaction
 * @param from The sender address
 * @param timelockAddress The timelock contract address
 */
function handleETHValueRequirements(
  simulationPayload: TenderlyPayload,
  values: readonly bigint[],
  from: Address,
  timelockAddress: Address,
): void {
  const totalValue = values.reduce((sum, val) => sum + val, 0n);

  if (totalValue > 0n) {
    // If we need to send ETH, update the value and from address balance
    simulationPayload.value = totalValue.toString();

    // Make sure the from address has enough balance to cover the transfer
    if (!simulationPayload.state_objects) {
      simulationPayload.state_objects = {};
    }
    simulationPayload.state_objects[from] = {
      ...simulationPayload.state_objects[from],
      balance: totalValue.toString(),
    };

    // Also ensure the timelock has enough ETH to execute the proposal
    simulationPayload.state_objects[timelockAddress] = {
      ...simulationPayload.state_objects[timelockAddress],
      balance: totalValue.toString(),
    };
  }
}

/**
 * @notice Builds a Tenderly simulation payload with common configuration
 * @param params Configuration parameters for the simulation payload
 */
function buildSimulationPayload(params: SimulationPayloadParams): TenderlyPayload {
  const {
    governor,
    timelock,
    from,
    latestBlock,
    simBlock,
    simTimestamp,
    storageObj,
    executeInputs,
    saveIfFails = false,
  } = params;

  return {
    network_id: '1',
    // this field represents the block state to simulate against, so we use the latest block number
    block_number: Number(latestBlock.number),
    from,
    to: governor.address,
    input: encodeFunctionData({
      abi: governor.abi,
      functionName: 'execute',
      args: executeInputs,
    }),
    gas: BLOCK_GAS_LIMIT,
    gas_price: '0',
    value: '0', // Will be updated by handleETHValueRequirements if needed
    save_if_fails: saveIfFails, // Set to true to save the simulation to your Tenderly dashboard if it fails.
    save: false, // Set to true to save the simulation to your Tenderly dashboard if it succeeds.
    generate_access_list: true, // not required, but useful as a sanity check to ensure consistency in the simulation response
    block_header: {
      // this data represents what block.number and block.timestamp should return in the EVM during the simulation
      number: toHex(simBlock),
      timestamp: toHex(simTimestamp),
    },
    state_objects: {
      // Since gas price is zero, the sender needs no balance. If the sender does need a balance to
      // send ETH with the execution, this will be overridden later.
      [from]: { balance: '0' },
      // Ensure transactions are queued in the timelock
      [timelock.address]: {
        storage: storageObj.stateOverrides[timelock.address.toLowerCase()].value,
      },
      // Ensure governor storage is properly configured so `state(proposalId)` returns `Queued`
      [governor.address]: {
        storage: storageObj.stateOverrides[governor.address.toLowerCase()].value,
      },
    },
  };
}

/**
 * @notice Builds governor state overrides for simulation
 * @param params Configuration parameters for governor overrides
 */
function buildGovernorStateOverrides(params: GovernorOverrideParams): Record<string, string> {
  const {
    governorType,
    proposalId,
    votingTokenSupply,
    eta,
    simBlock,
    targets,
    values,
    signatures,
    calldatas,
    description,
    proposal,
  } = params;

  if (governorType === 'bravo') {
    const proposalKey = `proposals[${proposalId.toString()}]`;
    const overrides: Record<string, string> = {
      proposalCount: proposalId.toString(),
      [`${proposalKey}.eta`]: eta.toString(),
      [`${proposalKey}.canceled`]: 'false',
      [`${proposalKey}.executed`]: 'false',
      [`${proposalKey}.forVotes`]: votingTokenSupply.toString(),
      [`${proposalKey}.againstVotes`]: '0',
      [`${proposalKey}.abstainVotes`]: '0',
    };

    // Add full proposal data for new proposals
    if (targets && values && signatures && calldatas && proposal) {
      overrides[`${proposalKey}.id`] = proposalId.toString();
      overrides[`${proposalKey}.proposer`] = DEFAULT_SIMULATION_ADDRESS;
      overrides[`${proposalKey}.startBlock`] = proposal.startBlock.toString();
      overrides[`${proposalKey}.endBlock`] = proposal.endBlock.toString();
      overrides[`${proposalKey}.targets.length`] = targets.length.toString();
      overrides[`${proposalKey}.values.length`] = targets.length.toString();
      overrides[`${proposalKey}.signatures.length`] = targets.length.toString();
      overrides[`${proposalKey}.calldatas.length`] = targets.length.toString();

      targets.forEach((target, i) => {
        const value = BigInt(values[i]).toString();
        overrides[`${proposalKey}.targets[${i}]`] = target;
        overrides[`${proposalKey}.values[${i}]`] = value;
        overrides[`${proposalKey}.signatures[${i}]`] = signatures[i];
        overrides[`${proposalKey}.calldatas[${i}]`] = calldatas[i];
      });
    }

    return overrides;
  }

  if (governorType === 'oz') {
    const proposalCoreKey = `_proposals[${proposalId.toString()}]`;
    const proposalVotesKey = `_proposalVotes[${proposalId.toString()}]`;
    const overrides: Record<string, string> = {
      [`${proposalCoreKey}.voteEnd._deadline`]: (simBlock - 1n).toString(),
      [`${proposalCoreKey}.canceled`]: 'false',
      [`${proposalCoreKey}.executed`]: 'false',
      [`${proposalVotesKey}.forVotes`]: votingTokenSupply.toString(),
      [`${proposalVotesKey}.againstVotes`]: '0',
      [`${proposalVotesKey}.abstainVotes`]: '0',
    };

    // Add operation hashes for new proposals
    if (targets && values && calldatas && description) {
      targets.forEach((target, i) => {
        const id = hashOperationOz(target, values[i], calldatas[i], zeroHash, zeroHash);
        overrides[`_timestamps[${id}]`] = '2'; // must be > 1.
      });
    }

    return overrides;
  }

  throw new Error(`Cannot generate overrides for unknown governor type: ${governorType}`);
}

// Sleep for the specified number of milliseconds
const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay)); // delay in milliseconds

// Get a random integer between two values
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min) + min); // max is exclusive, min is inclusive

/**
 * @notice Given a Tenderly contract object, generates a descriptive human-friendly name for that contract
 * @param contract Tenderly contract object to generate name from
 * @param chainId Optional chain ID to fetch better contract names from block explorers
 */
export async function getContractName(
  contract: TenderlyContract | undefined,
  chainId?: number,
): Promise<string> {
  if (!contract) return 'Unknown Contract';

  const contractAddress = getAddress(contract.address);

  // Priority 1: Use token metadata for semantic names (like "ARB Token") when available
  if (contract?.token_data?.name) {
    const tokenName = contract.token_data.name;
    // Try to get token symbol to make it more descriptive
    try {
      if (chainId && (chainId === 42161 || chainId === 1)) {
        const metadata = await fetchTokenMetadata(contractAddress);
        const symbol = metadata.symbol || contract.token_data.symbol || tokenName;
        return `${tokenName} (${symbol}) at \`${contractAddress}\``;
      }
    } catch (error) {
      // Fallback to just token name if metadata fetch fails
      console.debug(
        `[Contract Name] Failed to fetch token metadata for ${contractAddress}:`,
        error,
      );
    }
    // Use token name with symbol from Tenderly if available
    const symbol = contract.token_data.symbol || tokenName;
    return `${tokenName} (${symbol}) at \`${contractAddress}\``;
  }

  // Priority 2: Use Tenderly's contract name (like "TransparentUpgradeableProxy")
  const contractName = contract?.contract_name || 'Unknown Contract';
  return `${contractName} at \`${contractAddress}\``;
}

/**
 * @notice Uses only Tenderly's contract metadata for naming (no additional API calls)
 * @param contract Tenderly contract object to generate name from
 */
export function getContractNameFromTenderly(contract: TenderlyContract | undefined): string {
  if (!contract) return 'Unknown Contract';

  const contractAddress = getAddress(contract.address);

  // Priority 1: Use token name if available for better semantic naming
  if (contract?.token_data?.name) {
    const tokenName = contract.token_data.name;
    const symbol = contract.token_data.symbol || tokenName;
    return `${tokenName} (${symbol}) at \`${contractAddress}\``;
  }

  // Priority 2: Fall back to technical contract name
  const contractName = contract?.contract_name || 'Unknown Contract';
  return `${contractName} at \`${contractAddress}\``;
}

/**
 * Gets the latest block number known to Tenderly
 * @param chainId Chain ID to get block number for
 */
async function getLatestBlock(chainId: number): Promise<number> {
  try {
    // Send simulation request
    const url = `${TENDERLY_BASE_URL}/network/${(chainId).toString()}/block-number`;
    const fetchOptions = <Partial<FETCH_OPT>>{
      method: 'GET',
      ...TENDERLY_FETCH_OPTIONS,
    };
    const res = await fetchUrl(url, fetchOptions);
    return res.block_number as number;
  } catch (err) {
    console.log('logging getLatestBlock error');
    console.log(JSON.stringify(err, null, 2));
    throw err;
  }
}

/**
 * @notice Encode state overrides
 * @param payload State overrides to send
 */
async function sendEncodeRequest(payload: StateOverridesPayload): Promise<StorageEncodingResponse> {
  try {
    const fetchOptions = <Partial<FETCH_OPT>>{
      method: 'POST',
      data: payload,
      ...TENDERLY_FETCH_OPTIONS,
    };
    const response = await fetchUrl(TENDERLY_ENCODE_URL, fetchOptions);

    return response as StorageEncodingResponse;
  } catch (err) {
    console.log('logging sendEncodeRequest error');
    console.log(JSON.stringify(err, null, 2));
    console.log(JSON.stringify(payload));
    throw err;
  }
}

/**
 * @notice Sends a transaction simulation request to the Tenderly API
 * @dev Uses a simple exponential backoff when requests fail, with the following parameters:
 *   - Initial delay is 1 second
 *   - We randomize the delay duration to avoid synchronization issues if client is sending multiple requests simultaneously
 *   - We double delay each time and throw an error if delay is over 8 seconds
 * @param payload Transaction simulation parameters
 * @param delay How long to wait until next simulation request after failure, in milliseconds
 */
async function sendSimulation(payload: TenderlyPayload, delay = 1000): Promise<TenderlySimulation> {
  const fetchOptions = <Partial<FETCH_OPT>>{
    method: 'POST',
    data: payload,
    ...TENDERLY_FETCH_OPTIONS,
  };
  try {
    // Send simulation request
    const sim = <TenderlySimulation>await fetchUrl(TENDERLY_SIM_URL, fetchOptions);

    // Post-processing to ensure addresses we use are checksummed (since ethers returns checksummed addresses)
    sim.transaction.addresses = sim.transaction.addresses.map(getAddress);
    for (const contract of sim.contracts) {
      contract.address = getAddress(contract.address);
    }

    return sim;
  } catch (err) {
    console.log('err in sendSimulation: ', JSON.stringify(err));
    const is429 = (err as TenderlyError)?.statusCode === 429;
    if (delay > 8000 || !is429) {
      console.warn('Simulation request failed with the below request payload and error');
      console.log(JSON.stringify(fetchOptions));
      throw err;
    }
    console.warn(err);
    console.warn(
      `Simulation request failed with the above error, retrying in ~${delay} milliseconds. See request payload below`,
    );
    console.log(JSON.stringify(payload));
    await sleep(delay + randomInt(0, 1000));
    return await sendSimulation(payload, delay * 2);
  }
}

/**
 * @notice Computes transaction hashes used by the Timelock for queuing transactions
 * @param targets Array of target contract addresses
 * @param values Array of ETH values to send with each transaction
 * @param signatures Array of function signatures
 * @param calldatas Array of encoded calldata
 * @param eta Execution timestamp
 * @returns Array of transaction hashes
 */
function computeTransactionHashes(
  targets: readonly `0x${string}`[],
  values: readonly bigint[],
  signatures: readonly `0x${string}`[],
  calldatas: readonly `0x${string}`[],
  eta: bigint,
): string[] {
  return targets.map((target, i) => {
    const [val, sig, calldata] = [values[i], signatures[i], calldatas[i]];
    return keccak256(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'uint256' },
          { type: 'string' },
          { type: 'bytes' },
          { type: 'uint256' },
        ],
        [target, val, sig, calldata, eta],
      ),
    );
  });
}
