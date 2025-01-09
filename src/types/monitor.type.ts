export type AddressActivity = {
  lastSeen: number;
  methodCounts: { [methodId: string]: { count: number; firstBlock: number } };
};

export interface Config {
  blockRange: number;
  minConsecutiveBlocks: number;
}

export interface CustomError {
  message: string;
}
