import { parseAbi } from 'viem';

export const timelockAbi = parseAbi([
  'function GRACE_PERIOD() view returns (uint256)',
  'function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) returns (bytes32)',
  'function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) payable returns (bytes)',
  'function queuedTransactions(bytes32) view returns (bool)',
  'function delay() view returns (uint256)',
  'function admin() view returns (address)',
  'function pendingAdmin() view returns (address)',
  'function acceptAdmin()',
  'function setPendingAdmin(address pendingAdmin_)',
  'function setDelay(uint256 delay_)',
  'event NewAdmin(address indexed newAdmin)',
  'event NewPendingAdmin(address indexed newPendingAdmin)',
  'event NewDelay(uint256 indexed newDelay)',
  'event QueueTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta)',
  'event ExecuteTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta)',
  'event CancelTransaction(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data, uint eta)',
]);
