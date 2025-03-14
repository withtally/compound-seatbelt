import { getAddress } from '@ethersproject/address';
import type { Abi } from 'viem';

// Cache for ABIs to avoid redundant API calls
const abiCache: Record<string, Abi> = {};

// Simple delay function to help with rate limiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Define a type for the Etherscan API response
interface EtherscanApiResponse {
  status: string;
  message: string;
  result: string | null;
}

/**
 * Fetches the ABI for a contract from Etherscan
 * @param address The contract address
 * @param chainId The chain ID (defaults to 1 for Ethereum mainnet)
 * @returns The parsed ABI or null if not found
 */
export async function fetchContractAbi(address: string, chainId = 1): Promise<Abi | null> {
  console.log(`[DEBUG] Fetching ABI for ${address} on chain ${chainId}`);
  try {
    // Normalize the address
    const normalizedAddress = getAddress(address);

    // Check cache first
    const cacheKey = `${chainId}:${normalizedAddress}`;
    if (abiCache[cacheKey]) {
      console.log(`[DEBUG] Using cached ABI for ${normalizedAddress}`);
      return abiCache[cacheKey];
    }

    // Determine the API URL based on the chain ID
    const apiUrl = getEtherscanApiUrl(chainId);
    if (!apiUrl) {
      console.warn(`Unsupported chain ID: ${chainId}`);
      return null;
    }

    // Get the API key from environment variables
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      console.warn('ETHERSCAN_API_KEY not found in environment variables');
      return null;
    }

    // Retry mechanism for API requests
    const maxRetries = 3;
    let retryCount = 0;
    let data: EtherscanApiResponse | undefined;

    while (retryCount < maxRetries) {
      console.log(
        `[DEBUG] Making API request to Etherscan for ${normalizedAddress} (attempt ${retryCount + 1}/${maxRetries})`,
      );

      // Add a delay before making the API call to avoid rate limiting
      // Etherscan free API keys are limited to 5 calls per second
      await delay(1000); // 1000ms delay to be more conservative with rate limiting

      try {
        // Fetch the ABI from Etherscan
        const url = `${apiUrl}/api?module=contract&action=getabi&address=${normalizedAddress}&apikey=${apiKey}`;
        const response = await fetch(url);
        data = (await response.json()) as EtherscanApiResponse;

        if (data.status === '1' && data.result) {
          break; // Success, exit the retry loop
        }

        console.warn(
          `Failed to fetch ABI for ${normalizedAddress} (attempt ${retryCount + 1}/${maxRetries}): ${data.message || 'Unknown error'}, Status: ${data.status}, Result: ${data.result}`,
        );
        retryCount++;

        if (retryCount < maxRetries) {
          // Exponential backoff for retries
          await delay(1000 * 2 ** retryCount);
        }
      } catch (error) {
        console.error(
          `Error fetching ABI for ${normalizedAddress} (attempt ${retryCount + 1}/${maxRetries}):`,
          error,
        );
        retryCount++;

        if (retryCount < maxRetries) {
          // Exponential backoff for retries
          await delay(1000 * 2 ** retryCount);
        }
      }
    }

    if (!data || data.status !== '1' || !data.result) {
      console.warn(
        `Failed to fetch ABI for ${normalizedAddress} after ${maxRetries} attempts: ${data?.message || 'Unknown error'}, Status: ${data?.status}, Result: ${data?.result}`,
      );
      return null;
    }

    // Parse the ABI
    try {
      console.log(`[DEBUG] Successfully fetched ABI for ${normalizedAddress}`);

      // Parse the ABI string into a JSON object
      const abiJson = JSON.parse(data.result);

      // Validate that it's an array
      if (!Array.isArray(abiJson)) {
        console.warn(`Invalid ABI format for ${normalizedAddress}: not an array`);
        return null;
      }

      // Cache the result
      abiCache[cacheKey] = abiJson as Abi;

      return abiJson as Abi;
    } catch (error) {
      console.error(`Error parsing ABI for ${normalizedAddress}:`, error);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching ABI for ${address}:`, error);
    return null;
  }
}

/**
 * Gets the Etherscan API URL for a given chain ID
 * @param chainId The chain ID
 * @returns The Etherscan API URL or null if unsupported
 */
function getEtherscanApiUrl(chainId: number): string | null {
  switch (chainId) {
    case 1: // Ethereum Mainnet
      return 'https://api.etherscan.io';
    default:
      return 'https://api.etherscan.io';
  }
}

/**
 * Decodes function data using the fetched ABI
 * @param address The contract address
 * @param data The function data to decode
 * @param chainId The chain ID (defaults to 1 for Ethereum mainnet)
 * @returns The decoded function data or null if not found
 */
export async function decodeFunctionWithAbi(
  address: string,
  data: `0x${string}`,
  chainId = 1,
): Promise<{ name: string; args: unknown[] } | null> {
  console.log(
    `[DEBUG] Attempting to decode function data for ${address} with selector ${data.slice(0, 10)}`,
  );
  try {
    const abi = await fetchContractAbi(address, chainId);
    if (!abi) {
      console.log(`[DEBUG] No ABI found for ${address}`);
      return null;
    }

    // Find the function that matches the selector
    const selector = data.slice(0, 10);

    // Import decodeFunctionData from viem in the function scope to avoid circular dependencies
    const { decodeFunctionData } = await import('viem');

    try {
      console.log(`[DEBUG] Attempting to decode with ABI for ${address}`);
      const decoded = decodeFunctionData({
        abi,
        data,
      });

      console.log(`[DEBUG] Successfully decoded function: ${decoded.functionName}`);
      return {
        name: decoded.functionName,
        args: Array.isArray(decoded.args) ? decoded.args : [decoded.args],
      };
    } catch (error) {
      console.warn(
        `Failed to decode function data for ${address} with selector ${selector}:`,
        error,
      );
      return null;
    }
  } catch (error) {
    console.error(`Error decoding function data for ${address}:`, error);
    return null;
  }
}
