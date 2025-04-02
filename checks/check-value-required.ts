import { formatEther } from 'viem';
import type { ProposalCheck } from '../types';

/**
 * Reports on whether the caller initiating the `execute` call needs to send ETH with the call.
 */
export const checkValueRequired: ProposalCheck = {
  name: 'Reports on whether the caller needs to send ETH with the call',
  async checkProposal(proposal, sim, _) {
    const totalValue = proposal.values.reduce((sum, cur) => sum + cur, 0n);
    const txValue = BigInt(sim.simulation.value);

    if (txValue === 0n) {
      const msg = 'No ETH is required to be sent by the account that executes this proposal.';
      return { info: [msg], warnings: [], errors: [] };
    }

    const valueRequired = formatEther(totalValue);
    const valueSent = formatEther(txValue);

    // For governance proposals with ETH transfers, the flow is:
    // caller -> governor -> timelock -> target
    const msg1 =
      'The account that executes this proposal will need to send ETH along with the transaction.';
    const msg2 = `The calls made by this proposal require a total of ${valueRequired} ETH.`;
    const msg3 = `Due to the flow of ETH in governance proposals (caller -> governor -> timelock -> target), the full amount of ${valueSent} ETH must be sent with the transaction.`;

    const msg = `${msg1}\n\n${msg2} ${msg3}`;

    return { info: [], warnings: [msg], errors: [] };
  },
};
