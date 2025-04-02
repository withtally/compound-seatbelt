import { encodeFunctionData, namehash, parseAbi } from 'viem';
/**
 * @notice Sample simulation configuration file for the Celo bridge reconfiguration proposal.
 */
import type { SimulationConfigNew } from '../types';

// Get interfaces to facilitate encoding the calls we want to execute.
const ensPublicResolverAbi = parseAbi([
  'function setText(bytes32 node, string calldata key, string calldata value) external',
]);

const ensPublicResolver = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41' as const;
const subnameHash = namehash('v3deployments.uniswap.eth');

console.log({
  subnameHash,
});

// update celo text record
const call1 = {
  target: ensPublicResolver, // ENS Public Resolver.
  calldata: encodeFunctionData({
    abi: ensPublicResolverAbi,
    functionName: 'setText',
    args: [
      // Node.
      subnameHash,
      // Key.
      '42220',
      // Value.
      '0xf5F4496219F31CDCBa6130B5402873624585615a, 0xAfE208a311B21f13EF87E33A90049fC17A7acDEc',
    ],
  }),
  value: 0n,
  signature: '',
};

const calls = [call1];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const,
  governorType: 'bravo',
  targets: calls.map((item) => item.target),
  values: calls.map((item) => item.value),
  signatures: calls.map((item) => item.signature as `0x${string}`),
  calldatas: calls.map((item) => item.calldata),
  description: 'Deploy and Populate new subdomain',
};
