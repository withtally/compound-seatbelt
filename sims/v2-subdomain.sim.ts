import { encodeFunctionData, labelhash, namehash, parseAbi } from 'viem';
/**
 * @notice
 This proposal creates a new subdomain on the uniswap.eth ENS name and populates its text records
 with addresses of v2 deployments
 */
import type { SimulationConfigNew } from '../types';
import ENSPublicResolverABI from '../utils/abis/ENSPublicResolverABI.json' assert { type: 'json' };

const ensRegistryAbi = parseAbi([
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl) external',
]);

const ensRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const;
const ensPublicResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41' as const;

const timelock = '0x1a9C8182C09F50C8318d769245beA52c32BE35BC' as const;
const nameHash = namehash('uniswap.eth');
const labelHash = labelhash('v2deployments');
const subnameHash = namehash('v2deployments.uniswap.eth');

// generate Optimism bytes
const optimism = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '10',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1, 0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf',
  ],
});

// generate arbitrum bytes
const arbitrum = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '42161',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0x4Dbd4fc535Ac27206064B68FfCf827b0A60BAB3f, 0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
  ],
});

// generate avalanche bytes
const avalanche = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '43114',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xeb0BCF27D1Fb4b25e708fBB815c421Aeb51eA9fc, 0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
  ],
});

// generate base bytes
const base = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '8453',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0x866E82a600A1414e583f7F13623F1aC5d58b0Afa, 0x8909dc15e40173ff4699343b6eb8132c65e18ec6',
  ],
});

// generate binance bytes
const binance = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '56',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xf5F4496219F31CDCBa6130B5402873624585615a, 0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  ],
});

// generate polygon bytes
const polygon = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '137',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xfe5e5D361b2ad62c541bAb87C45a0B9B018389a2, 0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
  ],
});

// generate gnosis bytes
const gnosis = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '100',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xf5F4496219F31CDCBa6130B5402873624585615a, 0x8c8b524ce7c9D2e3f59aB6711bE4Ac826FA46a0f',
  ],
});

// generate Boba bytes
const boba = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '288',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0x6D4528d192dB72E282265D6092F4B872f9Dff69e, 0x40a26d18440948d8eE121b78ca4e88C37D30143b',
  ],
});

// generate linea bytes
const linea = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '59144',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xd19d4B5d358258f05D7B411E21A1460D11B0876F, 0x114a43df6c5f54ebb8a9d70cd1951d3dd68004c7',
  ],
});

// generate moonbeam bytes
const moonbeam = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '1284',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xf5F4496219F31CDCBa6130B5402873624585615a, 0x114a43df6c5f54ebb8a9d70cd1951d3dd68004c7',
  ],
});

// generate celo bytes
const celo = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '42220',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xf5F4496219F31CDCBa6130B5402873624585615a, 0x114a43df6c5f54ebb8a9d70cd1951d3dd68004c7',
  ],
});

// generate scroll bytes
const scroll = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '534352',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0x6774Bcbd5ceCeF1336b5300fb5186a12DDD8b367, 0x114a43df6c5f54ebb8a9d70cd1951d3dd68004c7',
  ],
});

// generate rootstock bytes
const rootstock = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '30',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0xf5F4496219F31CDCBa6130B5402873624585615a, 0x114a43df6c5f54ebb8a9d70cd1951d3dd68004c7',
  ],
});

// generate filecoin bytes
const filecoin = encodeFunctionData({
  abi: ENSPublicResolverABI,
  functionName: 'setText',
  args: [
    // Node.
    subnameHash,
    // Key: Network ID
    '314',
    // Value: bridge sender addres (mainnet), v2Factory address (destination chain)
    '0x1f8A4d195B647647c7dD45650CBd553FD33cCAA6, 0x114a43df6c5f54ebb8a9d70cd1951d3dd68004c7',
  ],
});

// log outputs for tally
console.log({
  nameHash,
  labelHash,
  subnameHash,
  optimism,
  arbitrum,
  avalanche,
  polygon,
  base,
  binance,
  celo,
  gnosis,
  boba,
  moonbeam,
  linea,
  scroll,
  rootstock,
  filecoin,
});

// add subname
const call1 = {
  target: ensRegistryAddress,
  calldata: encodeFunctionData({
    abi: ensRegistryAbi,
    functionName: 'setSubnodeRecord',
    args: [
      nameHash, // Node.
      labelHash, // Label.
      timelock, // Owner.
      ensPublicResolverAddress, // Resolver.
      0n, // TTL.
    ],
  }),
  value: 0n,
  signature: '',
};

// add text records in multicall
const call2 = {
  target: ensPublicResolverAddress,
  calldata: encodeFunctionData({
    abi: ENSPublicResolverABI,
    functionName: 'multicall',
    args: [
      [
        optimism,
        arbitrum,
        avalanche,
        polygon,
        base,
        binance,
        celo,
        gnosis,
        boba,
        moonbeam,
        linea,
        scroll,
        rootstock,
        filecoin,
      ],
    ],
  }),
  value: 0n,
  signature: '',
};

const calls = [call1, call2];

export const config: SimulationConfigNew = {
  type: 'new',
  daoName: 'Uniswap',
  governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3' as const,
  governorType: 'bravo',
  targets: calls.map((item) => item.target as `0x${string}`),
  values: calls.map((item) => item.value),
  signatures: calls.map((item) => item.signature as `0x${string}`),
  calldatas: calls.map((item) => item.calldata as `0x${string}`),
  description: 'Deploy and Populate new subdomain',
};
