import { encodeFunctionData } from 'viem';

/**
 * @notice Sample simulation configuration file for the arb lm distribution proposal.
 */
import type { SimulationConfigNew } from '../types';
import L1BaseCrossChainMessenger from '../utils/abis/L1BaseCrossChainMessenger.json' assert {
  type: 'json',
};
import L2CrossChainAccount from '../utils/abis/L2CrossChainAccount.json' assert { type: 'json' };
import v3FactoryAbi from '../utils/abis/v3FactoryAbi.json' assert { type: 'json' };

// Get interfaces to facilitate encoding the calls we want to execute.
const baseInboxAddress = '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa' as const;
const l2AccountForwarderAddress = '0x31FAfd4889FA1269F7a13A66eE0fB458f27D72A9' as const;
const v3FactoryAddress = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as const;

// get encoded function calls
const bps2Enable = encodeFunctionData({
  abi: v3FactoryAbi,
  functionName: 'enableFeeAmount',
  args: [200, 4],
});
const bps3Enable = encodeFunctionData({
  abi: v3FactoryAbi,
  functionName: 'enableFeeAmount',
  args: [300, 6],
});
const bps4Enable = encodeFunctionData({
  abi: v3FactoryAbi,
  functionName: 'enableFeeAmount',
  args: [400, 8],
});

console.log({ bps2Enable, bps3Enable, bps4Enable });

const bps2EnableForward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [v3FactoryAddress, bps2Enable],
});
const bps3EnableForward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [v3FactoryAddress, bps3Enable],
});
const bps4EnableForward = encodeFunctionData({
  abi: L2CrossChainAccount,
  functionName: 'forward',
  args: [v3FactoryAddress, bps4Enable],
});

console.log({ bps2EnableForward, bps3EnableForward, bps4EnableForward });

const calldataTest = encodeFunctionData({
  abi: L1BaseCrossChainMessenger,
  functionName: 'sendMessage',
  args: [
    // _target
    l2AccountForwarderAddress,
    // _msg
    bps4EnableForward,
    // _minGasLimit
    1000000n,
  ],
});

console.log({ calldataTest });
// call bps4
const call1 = {
  target: baseInboxAddress,
  calldata: calldataTest,
  value: 0n,
  signature: '',
};

console.log({ call1 });

// call bps3
const call2 = {
  target: baseInboxAddress,
  calldata: encodeFunctionData({
    abi: L1BaseCrossChainMessenger,
    functionName: 'sendMessage',
    args: [
      // _target
      l2AccountForwarderAddress,
      // _msg
      bps3EnableForward,
      // _minGasLimit
      1000000n,
    ],
  }),
  value: 0n,
  signature: '',
};

// call bps2
const call3 = {
  target: baseInboxAddress,
  calldata: encodeFunctionData({
    abi: L1BaseCrossChainMessenger,
    functionName: 'sendMessage',
    args: [
      // _target
      l2AccountForwarderAddress,
      // _msg
      bps2EnableForward,
      // _minGasLimit
      1000000n,
    ],
  }),
  value: 0n,
  signature: '',
};

const calls = [call1, call2, call3];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const,
  governorType: 'bravo',
  targets: calls.map((item) => item.target),
  values: calls.map((item) => item.value),
  signatures: calls.map((item) => item.signature as `0x${string}`),
  calldatas: calls.map((item) => item.calldata),
  description: 'test',
};
