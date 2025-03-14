/**
 * @notice Script to run checks for a specific proposal ID
 */

import { getAddress } from '@ethersproject/address';
import { BigNumber } from '@ethersproject/bignumber';
import ALL_CHECKS from './checks';
import { generateAndSaveReports } from './presentation/report';
import type { AllCheckResults, GovernorType, SimulationConfig } from './types';
import { provider } from './utils/clients/ethers';
import { simulate } from './utils/clients/tenderly';
import { DAO_NAME, GOVERNOR_ADDRESS } from './utils/constants';
import {
  formatProposalId,
  getGovernor,
  getTimelock,
  inferGovernorType,
} from './utils/contracts/governor';
import { PROPOSAL_STATES } from './utils/contracts/governor-bravo';

/**
 * @notice Run checks for a specific proposal ID
 */
async function main() {
  // Validate inputs
  if (!GOVERNOR_ADDRESS) throw new Error('Must provide a GOVERNOR_ADDRESS');
  if (!DAO_NAME) throw new Error('Must provide a DAO_NAME');

  // Set the proposal ID to check
  const proposalId = process.argv[2] ? BigNumber.from(process.argv[2]) : BigNumber.from(81); // Default to 81 if no argument provided

  // Get governor type and contract
  const governorType = await inferGovernorType(GOVERNOR_ADDRESS);
  const governor = getGovernor(governorType, GOVERNOR_ADDRESS);

  // Get proposal state to determine simulation type
  const state = await governor.state(proposalId);
  const stateStr = String(state) as keyof typeof PROPOSAL_STATES;
  const isExecuted = PROPOSAL_STATES[stateStr] === 'Executed';
  const simType = isExecuted ? 'executed' : 'proposed';

  console.log(
    `Running checks for ${DAO_NAME} proposal ${proposalId} (${PROPOSAL_STATES[stateStr]})...`,
  );

  // Create simulation config
  const config: SimulationConfig = {
    type: simType,
    daoName: DAO_NAME,
    governorAddress: getAddress(GOVERNOR_ADDRESS),
    governorType,
    proposalId,
  };

  // Generate the proposal data and dependencies needed by checks
  const proposalData = {
    governor,
    provider,
    timelock: await getTimelock(governorType, governor.address),
  };

  // Run simulation
  console.log('Simulating proposal...');
  const { sim, proposal, latestBlock } = await simulate(config);
  console.log('Simulation complete.');

  // Run checks
  console.log('Running checks...');
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

  // Generate markdown report
  console.log('Generating report...');
  const [startBlock, endBlock] = await Promise.all([
    proposal.startBlock.toNumber() <= latestBlock.number
      ? provider.getBlock(proposal.startBlock.toNumber())
      : null,
    proposal.endBlock.toNumber() <= latestBlock.number
      ? provider.getBlock(proposal.endBlock.toNumber())
      : null,
  ]);

  // Save markdown report to a file
  const dir = `./reports/${config.daoName}/${config.governorAddress}`;
  await generateAndSaveReports(
    governorType,
    { start: startBlock, end: endBlock, current: latestBlock },
    proposal,
    checkResults,
    dir,
  );

  console.log(`Done! Report saved to ${dir}/${formatProposalId(governorType, proposalId)}.md`);
}

// Run the script
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
