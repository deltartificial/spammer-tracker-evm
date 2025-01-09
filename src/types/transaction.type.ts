export type Transaction = {
  hash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}` | null;
  input: string;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
};

export interface Methods {
  [key: string]: string;
}
