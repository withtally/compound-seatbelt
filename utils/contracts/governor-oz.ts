import type { Address } from 'viem';
import { getContract, pad } from 'viem';
import { GOVERNOR_OZ_ABI } from '../abis/GovernorOZ';
import { publicClient } from '../clients/client';
import { getSolidityStorageSlotUint } from '../utils';

export function governorOz(address: Address) {
  return getContract({ address, abi: GOVERNOR_OZ_ABI, client: publicClient });
}

// All possible states a proposal might be in.
// These are defined by the `ProposalState` enum so when we fetch the state of a proposal ID
// we receive an integer response, and use this to map that integer to the state
export const PROPOSAL_STATES = {
  '0': 'Pending',
  '1': 'Active',
  '2': 'Canceled',
  '3': 'Defeated',
  '4': 'Succeeded',
  '5': 'Queued',
  '6': 'Expired',
  '7': 'Executed',
} as const;

/**
 * @notice Returns an object containing various OZ Governor slots
 * @dev The slots here are for the `GovernorCountingSimpleUpgradeable` and
 * `TimelockControllerUpgradeable` OZ contracts, from lib/openzeppelin-contracts-upgradeable v4.7.3
 * (commit 0a2cb9a445c365870ed7a8ab461b12acf3e27d63)
 * @param id Proposal ID
 */
export function getOzSlots(proposalId: bigint) {
  // Proposal structs:
  //     struct ProposalCore {
  //       TimersUpgradeable.BlockNumber voteStart;  0
  //       TimersUpgradeable.BlockNumber voteEnd;    1
  //       bool executed;                            2
  //       bool canceled;                            3
  //     }
  //     struct ProposalVote {
  //       uint256 againstVotes;                     0
  //       uint256 forVotes;                         1
  //       uint256 abstainVotes;                     2
  //       mapping(address => bool) hasVoted;        3
  //     }
  const canceledSlotOffset = 3n; // this is packed with `executed`

  const againstVotesOffset = 0n;
  const forVotesOffset = 1n;
  const abstainVotesOffset = 2n;

  // Compute and return slot numbers
  const proposalCoreMapSlot = '0xcc' as const; // `_proposals` mapping
  const proposalCoreSlot = getSolidityStorageSlotUint(proposalCoreMapSlot, proposalId);

  const proposalVotesMapSlot = '0xfd' as const; // `_proposalVotes` mapping
  const proposalVotesSlot = getSolidityStorageSlotUint(proposalVotesMapSlot, proposalId);

  return {
    votingToken: '0x9' as const, // slot of voting token, e.g. UNI, COMP  (getter is named after token, so can't generalize it that way),
    canceled: pad(
      `0x${(BigInt(proposalCoreSlot) + canceledSlotOffset).toString(16)}` as `0x${string}`,
    ),
    // We don't need to set the ETA for OZ governors because they don't use it to check which state
    // a proposal is in. Therefore we choose an arbitrary slot here for typing purposes and just
    // set the ETA in an arbitrary slot for consistency. This slot is `keccak256("we don't need this for OZ governor")`
    eta: '0x42a5ef1591012b6beeb9636e75b28a676a23c97ad46ae6d83e11f22f52da96cc' as const,
    againstVotes: pad(
      `0x${(BigInt(proposalVotesSlot) + againstVotesOffset).toString(16)}` as `0x${string}`,
    ),
    forVotes: pad(
      `0x${(BigInt(proposalVotesSlot) + forVotesOffset).toString(16)}` as `0x${string}`,
    ),
    abstainVotes: pad(
      `0x${(BigInt(proposalVotesSlot) + abstainVotesOffset).toString(16)}` as `0x${string}`,
    ),
  };
}
