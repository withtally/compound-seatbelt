import { encodeFunctionData, erc20Abi, parseUnits } from 'viem';
/**
 * @notice Simulation configuration file for proposal 51.
 */
import type { SimulationConfigNew } from '../types';

// Token transfer parameters.
const token = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' as const; // UNI token address.
const to = '0xe571dC7A558bb6D68FfE264c3d7BB98B0C6C73fC' as const; // UF Treasury Safe
const amount = parseUnits('10685984.71', 18); // transfer 10.685m UNI, which has 18 decimals

// Define the parameters for the token transfer action.
const call1 = {
  target: token,
  calldata: encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  }),
  value: 0n,
  signature: '',
};

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorType: 'bravo',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const,
  targets: [call1.target],
  values: [call1.value],
  signatures: [call1.signature as `0x${string}`], // Cast to `0x${string}` to avoid type error
  calldatas: [call1.calldata],
  description: 'Transfer 10.685m UNI to UF Treasury',
};
