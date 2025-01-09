import type { PublicClient } from "viem";
import type {
  Methods,
  Transaction,
  AddressActivity,
  AppConfig,
} from "../types";
import { ERC20Service } from "./erc20.service";

export class TransactionMonitor {
  private addressActivities: Map<string, AddressActivity> = new Map();
  private methodIds: string[];
  private erc20Service: ERC20Service;

  constructor(
    private readonly client: PublicClient,
    private readonly config: AppConfig,
    private readonly methods: Methods
  ) {
    this.methodIds = Object.keys(methods);
    this.erc20Service = new ERC20Service(client, config);
  }

  private getMethodId(input: string): string | null {
    if (input.length < 10) return null;
    const methodId = input.slice(0, 10).toLowerCase();
    return this.methodIds.includes(methodId) ? methodId : null;
  }

  private cleanupOldActivities(currentBlock: bigint) {
    const cutoffBlock = currentBlock - BigInt(this.config.monitor.blockRange);
    for (const [address, activity] of this.addressActivities.entries()) {
      if (activity.lastSeen < Number(cutoffBlock)) {
        this.addressActivities.delete(address);
      }
    }
  }

  async processTransaction(tx: Transaction, blockNumber: bigint) {
    try {
      const methodId = this.getMethodId(tx.input);
      if (!methodId) return;

      const from = tx.from.toLowerCase();

      const currentActivity = this.addressActivities.get(from) || {
        lastSeen: Number(blockNumber),
        methodCounts: {},
      };

      if (!currentActivity.methodCounts[methodId]) {
        currentActivity.methodCounts[methodId] = {
          count: 1,
          firstBlock: Number(blockNumber),
        };
      } else {
        currentActivity.methodCounts[methodId].count++;
        console.log("\n   🎯 Method repetition detected:");
        console.log(`      Address: ${from}`);
        console.log(`      Method: ${this.methods[methodId]} (${methodId})`);
        console.log(
          `      Count: #${currentActivity.methodCounts[methodId].count}`
        );
        console.log("      ---");
      }

      currentActivity.lastSeen = Number(blockNumber);
      this.addressActivities.set(from, currentActivity);

      const methodCount = currentActivity.methodCounts[methodId];
      const blockSpan = Number(blockNumber) - methodCount.firstBlock;

      if (
        methodCount.count > 1 &&
        blockSpan <= this.config.monitor.blockRange
      ) {
        if (blockSpan >= this.config.monitor.minConsecutiveBlocks) {
          console.log("\n   🚨 SPAM ALERT:");
          console.log("   ----------------------------------------");
          console.log(`   From: ${from}`);
          console.log(`   Router: ${tx.to}`);
          console.log(`   Hash: ${tx.hash}`);
          console.log(`   Method: ${this.methods[methodId]} (${methodId})`);
          console.log(`   Occurrences: ${methodCount.count}`);
          console.log(
            `   Block span: ${blockSpan} (${methodCount.firstBlock} → ${blockNumber})`
          );
          console.log(`   Gas: ${Number(tx.maxFeePerGas || 0n) / 1e9} gwei`);
          console.log(
            `   Priority: ${Number(tx.maxPriorityFeePerGas || 0n) / 1e9} gwei`
          );

          const tokens = await this.erc20Service.analyzeTokens(tx.input);
          if (tokens.length > 0) {
            console.log("\n   📜 ERC20 Tokens involved:");
            for (const token of tokens) {
              console.log(`      • ${token.address}`);
            }
          }

          console.log("   ----------------------------------------\n");
        }
      }
    } catch (error: any) {
      console.log(`⚠️ Error processing transaction ${tx.hash}:`, error.message);
    }
  }

  async processBlock(
    block: { transactions: Transaction[] },
    blockNumber: bigint
  ) {
    try {
      console.log("\n============================================");
      console.log(`🆕 Block #${blockNumber}`);
      console.log(`📊 Transactions: ${block.transactions.length}`);
      console.log("============================================\n");

      this.cleanupOldActivities(blockNumber);

      for (const tx of block.transactions) {
        try {
          await this.processTransaction(tx, blockNumber);
        } catch (error) {
          console.log(
            `⚠️ Error processing transaction ${tx.hash}:`,
            (error as Error).message
          );
          continue;
        }
      }
    } catch (error) {
      console.log(`⚠️ Error processing block ${blockNumber}:`, error.message);
    }
  }
}
