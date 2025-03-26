/**
 * @notice Entry point for executing a single proposal against a forked mainnet
 */

import { existsSync } from 'node:fs';
import { getAddress } from '@ethersproject/address';
import type { Contract } from 'ethers';
import type { BigNumber } from 'ethers';
import ALL_CHECKS from './checks';
import { generateAndSaveReports } from './presentation/report';
import type {
  AllCheckResults,
  GovernorType,
  SimulationConfig,
  SimulationConfigBase,
  SimulationData,
} from './types';
import { cacheProposal, getCachedProposal, needsSimulation } from './utils/cache/proposalCache';
import { provider } from './utils/clients/ethers';
import { simulate } from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS, SIM_NAME } from './utils/constants';
import {
  formatProposalId,
  getGovernor,
  getProposalIds,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';

/**
 * @notice Simulate governance proposals and run proposal checks against them
 */
async function main() {
  // --- Run simulations ---
  // Prepare array to store all simulation outputs
  const simOutputs: SimulationData[] = [];

  let governor: Contract;
  let governorType: GovernorType;

  // Determine if we are running a specific simulation or all on-chain proposals for a specified governor.
  if (SIM_NAME) {
    // If a SIM_NAME is provided, we run that simulation
    const configPath = `./sims/${SIM_NAME}.sim.ts`;
    const config: SimulationConfig = await import(configPath).then((d) => d.config); // dynamic path `import` statements not allowed

    governorType = await inferGovernorType(config.governorAddress);
    governor = getGovernor(governorType, config.governorAddress);
    const proposalData = {
      governor,
      provider,
      timelock: await getTimelock(governorType, governor.address),
    };

    const { sim, proposal, latestBlock } = await simulate(config);
    simOutputs.push({ sim, proposal, latestBlock, config, deps: proposalData });

    // Run checks for the simulation
    console.log(`Running checks for ${SIM_NAME} simulation...`);
    const checkResults: AllCheckResults = Object.fromEntries(
      await Promise.all(
        Object.keys(ALL_CHECKS).map(async (checkId) => [
          checkId,
          {
            name: ALL_CHECKS[checkId].name,
            result: await ALL_CHECKS[checkId].checkProposal(proposal, sim, proposalData),
          },
        ]),
      ),
    );

    // Generate reports
    const [startBlock, endBlock] = await Promise.all([
      proposal.startBlock <= latestBlock.number
        ? provider.getBlock(Number(proposal.startBlock))
        : null,
      proposal.endBlock <= latestBlock.number ? provider.getBlock(Number(proposal.endBlock)) : null,
    ]);

    // Save reports
    const dir = `./reports/${config.daoName}/${config.governorAddress}`;
    await generateAndSaveReports(
      governorType,
      { start: startBlock, end: endBlock, current: latestBlock },
      proposal,
      checkResults,
      dir,
    );
  } else {
    // If no SIM_NAME is provided, we get proposals to simulate from the chain
    if (!GOVERNOR_ADDRESS) throw new Error('Must provide a GOVERNOR_ADDRESS');
    if (!DAO_NAME) throw new Error('Must provide a DAO_NAME');
    const latestBlock = await provider.getBlock('latest');

    // Fetch all proposal IDs
    governorType = await inferGovernorType(GOVERNOR_ADDRESS);
    const proposalIds = await getProposalIds(governorType, GOVERNOR_ADDRESS, latestBlock.number);
    governor = getGovernor(governorType, GOVERNOR_ADDRESS);

    // If we aren't simulating all proposals, filter down to just the active ones. For now we
    // assume we're simulating all by default
    const states = await Promise.all(proposalIds.map((id) => governor.state(id)));
    const simProposals: { id: BigNumber; simType: SimulationConfigBase['type']; state: string }[] =
      proposalIds.map((id, i) => {
        // If state is `Executed` (state 7), we use the executed sim type and effectively just
        // simulate the real transaction. For all other states, we use the `proposed` type because
        // state overrides are required to simulate the transaction
        const stateNum = String(states[i]) as keyof typeof PROPOSAL_STATES;
        const stateStr = PROPOSAL_STATES[stateNum] || 'Unknown';
        const isExecuted = stateStr === 'Executed';
        return {
          id,
          simType: isExecuted ? 'executed' : 'proposed',
          state: stateStr,
        };
      });

    // Filter proposals that need simulation based on cache status
    const proposalsToSimulate = simProposals.filter((simProposal) =>
      needsSimulation({
        daoName: DAO_NAME!,
        governorAddress: GOVERNOR_ADDRESS!,
        proposalId: simProposal.id.toString(),
        currentState: simProposal.state,
      }),
    );

    const cachedProposals = simProposals.filter(
      (simProposal) =>
        !needsSimulation({
          daoName: DAO_NAME!,
          governorAddress: GOVERNOR_ADDRESS!,
          proposalId: simProposal.id.toString(),
          currentState: simProposal.state,
        }),
    );

    // Load cached proposals
    for (const cachedProposal of cachedProposals) {
      console.log(
        `Using cached simulation and reports for ${DAO_NAME} proposal ${cachedProposal.id}...`,
      );
      const cachedData = getCachedProposal(
        DAO_NAME,
        GOVERNOR_ADDRESS,
        cachedProposal.id.toString(),
      );

      if (cachedData) {
        // If we have cached data and the reports already exist, skip this proposal
        const reportPath = `./reports/${DAO_NAME}/${GOVERNOR_ADDRESS}/${cachedProposal.id}.md`;
        if (existsSync(reportPath)) {
          console.log(`  Using cached report for proposal ${cachedProposal.id}`);
          continue;
        }
        simOutputs.push(cachedData);
      }
    }

    // Simulate proposals that need simulation
    const numProposalsToSimulate = proposalsToSimulate.length;
    if (numProposalsToSimulate > 0) {
      console.log(
        `Simulating ${numProposalsToSimulate} ${DAO_NAME} proposals: IDs of ${proposalsToSimulate
          .map((sim) => formatProposalId(governorType, sim.id))
          .join(', ')}`,
      );

      // Generate the proposal data and dependencies needed by checks
      const proposalData = {
        governor,
        provider,
        timelock: await getTimelock(governorType, governor.address),
      };

      for (const simProposal of proposalsToSimulate) {
        if (simProposal.simType === 'new')
          throw new Error('Simulation type "new" is not supported in this branch');
        // Determine if this proposal is already `executed` or currently in-progress (`proposed`)
        console.log(`  Simulating ${DAO_NAME} proposal ${simProposal.id}...`);
        const config: SimulationConfig = {
          type: simProposal.simType,
          daoName: DAO_NAME,
          governorAddress: getAddress(GOVERNOR_ADDRESS),
          governorType,
          proposalId: simProposal.id,
        };

        const { sim, proposal, latestBlock } = await simulate(config);
        const simulationData: SimulationData & { checkResults?: AllCheckResults } = {
          sim,
          proposal,
          latestBlock,
          config,
          deps: proposalData,
        };

        // Run checks immediately after simulation
        console.log(`  Running checks for proposal ${simProposal.id}...`);
        const checkResults: AllCheckResults = Object.fromEntries(
          await Promise.all(
            Object.keys(ALL_CHECKS).map(async (checkId) => [
              checkId,
              {
                name: ALL_CHECKS[checkId].name,
                result: await ALL_CHECKS[checkId].checkProposal(proposal, sim, proposalData),
              },
            ]),
          ),
        );

        // Generate reports immediately
        const [startBlock, endBlock] = await Promise.all([
          proposal.startBlock <= latestBlock.number
            ? provider.getBlock(Number(proposal.startBlock))
            : null,
          proposal.endBlock <= latestBlock.number
            ? provider.getBlock(Number(proposal.endBlock))
            : null,
        ]);

        // Save reports
        const dir = `./reports/${config.daoName}/${config.governorAddress}`;
        await generateAndSaveReports(
          governorType,
          { start: startBlock, end: endBlock, current: latestBlock },
          proposal,
          checkResults,
          dir,
        );

        // Cache everything together
        simulationData.checkResults = checkResults;
        simOutputs.push(simulationData);

        // Cache the simulation results with check results included
        cacheProposal(
          DAO_NAME,
          GOVERNOR_ADDRESS,
          simProposal.id.toString(),
          simProposal.state,
          simulationData,
        );

        console.log('    done');
      }
    } else {
      console.log(`No new proposals to simulate for ${DAO_NAME}`);
    }
  }

  // Remove the separate check and report generation loop since we now do it inline
  console.log('All done!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
