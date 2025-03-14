export function parseWeb3Error(error: Error): string {
  const message = error.message.toLowerCase();

  // User rejected transaction
  if (message.includes('user rejected') || message.includes('user denied')) {
    return 'Transaction was rejected';
  }

  // Insufficient balance
  if (message.includes('insufficient funds')) {
    return 'Insufficient funds for transaction';
  }

  // Not enough voting power
  if (message.includes('comp::propose: proposer votes below proposal threshold')) {
    return 'Not enough voting power to create proposal';
  }

  // Invalid proposal
  if (message.includes('invalid proposal length') || message.includes('governor::propose')) {
    return 'Invalid proposal parameters';
  }

  // Network error
  if (message.includes('network') || message.includes('connection')) {
    return 'Network error. Please check your connection';
  }

  // Fallback
  return error.message;
}
