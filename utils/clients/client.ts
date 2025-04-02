import { http, createPublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import { RPC_URL } from '../constants';

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});
