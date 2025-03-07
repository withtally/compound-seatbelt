import { getAddress } from '@ethersproject/address';
import { formatUnits } from '@ethersproject/units';
import { decodeFunctionData, parseAbiItem, toFunctionSelector } from 'viem';
import { bullet } from '../presentation/report';
import type { FluffyCall, ProposalCheck } from '../types';
import { fetchTokenMetadata } from '../utils/contracts/erc20';

/**
 * Decodes proposal target calldata into a human-readable format
 */
export const checkDecodeCalldata: ProposalCheck = {
  name: 'Decodes target calldata into a human-readable format',
  async checkProposal(proposal, sim, deps) {
    const warnings: string[] = [];
    // Generate the raw calldata for each proposal action
    const calldatas = proposal.signatures.map((sig, i) => {
      return sig
        ? `${toFunctionSelector(sig)}${proposal.calldatas[i].slice(2)}`
        : proposal.calldatas[i];
    });

    // Find the call with that calldata and parse it
    const calls = sim.transaction.transaction_info.call_trace.calls;
    const descriptions = await Promise.all(
      calldatas.map(async (calldata, i) => {
        // Find the first matching call
        let call = findMatchingCall(getAddress(deps.timelock.address), calldata, calls);
        if (!call) {
          // If we can't find the call in the trace, add a warning
          // Skip the warning for ETH transfers which might not appear in the trace
          if (!(calldata === '0x' && BigInt(proposal.values[i].toString()) > 0n)) {
            const msg = `Could not find matching call for target ${proposal.targets[i]} with calldata ${calldata}`;
            warnings.push(msg);
          }

          // Create a synthetic call
          call = {
            from: deps.timelock.address,
            to: proposal.targets[i],
            input: calldata,
            value: proposal.values[i].toString(),
          } as FluffyCall;
        } else {
          // If we found the call, check for subcalls with the same input data
          call = returnCallOrMatchingSubcall(calldata, call);
        }

        return prettifyCalldata(call, proposal.targets[i]);
      }),
    );

    const info = descriptions.filter((d) => d !== null).map((d) => bullet(d as string));
    return { info, warnings, errors: [] };
  },
};

// --- Helper methods ---

/**
 * Given an array of calls, find the call matching the provided from address and calldata by
 * recursively traversing all calls in the trace. This is required because the call we're looking
 * for is not always at the same depth of the call stack. If all governor `execute` calls were made
 * from an EOA this would be true, but because calls to `execute` can also be made from contracts
 * we don't know the depth of the call containing `calldata`
 * @dev Using any[] due to incompatible call types (CallTraceCall, FluffyCall) that share common properties
 */
// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function findMatchingCall(from: string, calldata: string, calls: any[]): FluffyCall | null {
  const callMatches = (f: string, c: string) =>
    getAddress(f) === getAddress(from) && c === calldata;
  for (const call of calls) {
    if (callMatches(call.from, call.input)) return call;
    if (call.calls) {
      const foundCall = findMatchingCall(from, calldata, call.calls);
      if (foundCall) return foundCall;
    }
  }
  return null;
}

/**
 * Given a call, check if any subcalls have matching calldata. If so, return the deepest call as
 * this will be the decoded call (e.g. if there are proxies the top level call with matching
 * calldata will be the fallback function)
 */
function returnCallOrMatchingSubcall(calldata: string, call: FluffyCall): FluffyCall {
  if (!call.calls || !call.calls?.length) return call;
  return call.calls[0].input === calldata
    ? returnCallOrMatchingSubcall(calldata, call.calls[0] as FluffyCall)
    : call;
}

/**
 * Given a call, generate a human-readable function signature
 */
function getSignature(call: FluffyCall) {
  // Return selector if call is not decoded, otherwise generate the signature
  if (!call.function_name) return call.input.slice(0, 10);
  let sig = `${call.function_name}(`;
  call.decoded_input?.forEach((arg, i) => {
    if (i !== 0) sig += ', ';
    sig += arg.soltype.type;
    sig += arg.soltype.name ? ` ${arg.soltype.name}` : '';
  });
  sig += ')(';
  call.decoded_output?.forEach((arg, i) => {
    if (i !== 0) sig += ', ';
    sig += arg.soltype.type;
    sig += arg.soltype.name ? ` ${arg.soltype.name}` : '';
  });
  sig += ')';
  return sig;
}

/**
 * Given a target, signature, and call, generate a human-readable description
 */
function getDescription(target: string, sig: string, call: FluffyCall) {
  let description = `On contract \`${target}\`, call `;
  if (!call.decoded_input) return `${description} \`${call.input}\` (not decoded)`;

  description += `\`${sig}\` with arguments `;
  call.decoded_input?.forEach((arg, i) => {
    if (i !== 0) description += ', ';
    description += '`';
    description += arg.soltype.name ? `${arg.soltype.name}=` : '';
    description += arg.value;
    description += '`';
  });

  return `${description} (generic)`;
}

/**
 * Given a call, return a human-readable description of the call
 */
async function prettifyCalldata(call: FluffyCall, target: string) {
  // Handle ETH transfers (empty calldata with value)
  if (call.input === '0x' && call.value && BigInt(call.value) > 0n) {
    const ethAmount = formatUnits(call.value, 18);
    return `\`${call.from}\` transfers ${ethAmount} ETH to \`${target}\` (formatted)`;
  }

  // Handle token transfers
  const selector = call.input.slice(0, 10);
  const isTokenAction = selector in TOKEN_HANDLERS;

  if (isTokenAction) {
    const { symbol, decimals } = await fetchTokenMetadata(call.to);
    return TOKEN_HANDLERS[selector](call, decimals || 0, symbol);
  }

  // Generic handling for non-token actions
  const sig = getSignature(call);
  return getDescription(target, sig, call);
}

const TOKEN_HANDLERS: Record<
  string,
  (call: FluffyCall, decimals: number, symbol: string | null) => string
> = {
  [toFunctionSelector('approve(address,uint256)')]: (
    call: FluffyCall,
    decimals: number,
    symbol: string | null,
  ) => {
    const { args } = decodeFunctionData({
      abi: [parseAbiItem('function approve(address spender, uint256 value)')],
      data: call.input as `0x${string}`,
    });
    const [spender, value] = args;
    return `\`${call.from}\` approves \`${getAddress(spender)}\` to spend ${formatUnits(value, decimals)} ${symbol} (formatted)`;
  },
  [toFunctionSelector('transfer(address,uint256)')]: (
    call: FluffyCall,
    decimals: number,
    symbol: string | null,
  ) => {
    const { args } = decodeFunctionData({
      abi: [parseAbiItem('function transfer(address to, uint256 value)')],
      data: call.input as `0x${string}`,
    });
    const [to, value] = args;
    return `\`${call.from}\` transfers ${formatUnits(value, decimals)} ${symbol} to \`${getAddress(to)}\` (formatted)`;
  },
  [toFunctionSelector('transferFrom(address,address,uint256)')]: (
    call: FluffyCall,
    decimals: number,
    symbol: string | null,
  ) => {
    const { args } = decodeFunctionData({
      abi: [parseAbiItem('function transferFrom(address from, address to, uint256 value)')],
      data: call.input as `0x${string}`,
    });
    const [from, to, value] = args;
    return `\`${call.from}\` transfers ${formatUnits(value, decimals)} ${symbol} from \`${getAddress(from)}\` to \`${getAddress(to)}\` (formatted)`;
  },
};
