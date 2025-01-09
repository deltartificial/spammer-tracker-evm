export interface Methods {
  [key: string]: string;
}

export type Transaction = {
  hash: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}` | null;
  input: string;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
};

export type AddressActivity = {
  lastSeen: number;
  methodCounts: { [methodId: string]: { count: number; firstBlock: number } };
};

export interface Config {
  blockRange: number;
  minConsecutiveBlocks: number;
}

export interface TokenInfo {
  address: string;
  isERC20: boolean;
}

export const ERC20_TOTAL_SUPPLY = "0x18160ddd";

export interface CustomError {
  message: string;
}
