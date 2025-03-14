import { useMutation } from '@tanstack/react-query';

export function useWriteExecuteProposal() {
  useMutation({
    mutationFn: async () => {
      // TODO: Implement proposal execution and tx sending
      // get the proposal id
      // call the execute proposal function with the proposal id
      // wait for the tx to be mined
      // return the proposal data
    },
    onSuccess: () => {
      // TODO: Implement success callback
      // invalidate any queries that need to be invalidated
    },
  });
}
