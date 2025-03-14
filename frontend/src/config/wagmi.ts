import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { QueryClient } from '@tanstack/react-query';
import { http } from 'viem';
import { mainnet } from 'wagmi/chains';

const mainnetRpcUrl = process.env.NEXT_PUBLIC_MAINNET_RPC_URL;
if (!mainnetRpcUrl) {
  throw new Error('Mainnet RPC URL is not defined');
}

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
if (!projectId) {
  throw new Error('Project ID is not defined');
}

export const queryClient = new QueryClient();

export const config = getDefaultConfig({
  appName: 'Governance Seatbelt',
  projectId,
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(mainnetRpcUrl),
  },
  ssr: true,
});
