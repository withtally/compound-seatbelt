/**
 * @notice Simulation configuration file for testing ETH and ERC20 transfers.
 */
import type { SimulationConfigNew } from "../types";
import { encodeFunctionData, erc20Abi, parseEther, parseUnits } from "viem";

// Use the same recipient address for both ETH and ERC20 transfers
const recipient = "0x0000000000000000000000000000000000000123";

// ETH transfer parameters
const ethAmount = parseEther("0.1"); // 0.1 ETH

// Token transfer parameters
const token = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"; // UNI token address
const tokenAmount = parseUnits("1000", 18); // transfer 1000 UNI, which has 18 decimals

// Define the parameters for the ETH transfer action
const call1 = {
	target: recipient,
	calldata: "0x", // Empty calldata for ETH transfer
	value: ethAmount,
	signature: "",
};

// Define the parameters for the token transfer action
const call2 = {
	target: token,
	calldata: encodeFunctionData({
		abi: erc20Abi,
		functionName: "transfer",
		args: [recipient, tokenAmount],
	}),
	value: 0n,
	signature: "",
};

export const config: SimulationConfigNew = {
	type: "new",
	daoName: "Uniswap",
	governorType: "bravo",
	governorAddress: "0x408ED6354d4973f66138C91495F2f2FCbd8724C3",
	targets: [call1.target, call2.target], // Array of targets to call
	values: [call1.value, call2.value], // Array of values with each call
	signatures: [call1.signature, call2.signature], // Array of function signatures
	calldatas: [call1.calldata, call2.calldata], // Array of encoded calldatas
	description: "Test both ETH and ERC20 transfers to the same address",
};
