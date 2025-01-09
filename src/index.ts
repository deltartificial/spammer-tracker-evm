import { createPublicClient, webSocket } from "viem";
import {
  type Transaction,
  type Config,
  type AddressActivity,
  type Methods,
} from "./types";
import { base } from "viem/chains";
import methodsJson from "../methods.json";

const methods: Methods = methodsJson;

const webSocketUrl = "wss://base-rpc.publicnode.com";

const DEFAULT_CONFIG: Config = {
  blockRange: 20,
  minConsecutiveBlocks: 0,
};

class TransactionMonitor {
  private addressActivities: Map<string, AddressActivity> = new Map();
  private methodIds: string[];
  private config: Config;

  constructor(config: Partial<Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.methodIds = Object.keys(methods);
  }

  private getMethodId(input: string): string | null {
    if (input.length < 10) return null;
    const methodId = input.slice(0, 10).toLowerCase();
    return this.methodIds.includes(methodId) ? methodId : null;
  }

  private cleanupOldActivities(currentBlock: bigint) {
    const cutoffBlock = currentBlock - BigInt(this.config.blockRange);
    for (const [address, activity] of this.addressActivities.entries()) {
      if (activity.lastSeen < Number(cutoffBlock)) {
        this.addressActivities.delete(address);
      }
    }
  }

  processTransaction(tx: Transaction, blockNumber: bigint) {
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
      console.log(`      Method: ${methods[methodId]} (${methodId})`);
      console.log(
        `      Count: #${currentActivity.methodCounts[methodId].count}`
      );
      console.log("      ---");
    }

    currentActivity.lastSeen = Number(blockNumber);
    this.addressActivities.set(from, currentActivity);

    const methodCount = currentActivity.methodCounts[methodId];
    const blockSpan = Number(blockNumber) - methodCount.firstBlock;

    if (methodCount.count > 1 && blockSpan <= this.config.blockRange) {
      if (blockSpan >= this.config.minConsecutiveBlocks) {
        console.log("\n   🚨 SPAM ALERT:");
        console.log("   ----------------------------------------");
        console.log(`   From: ${from}`);
        console.log(`   To: ${tx.to}`);
        console.log(`   Method: ${methods[methodId]} (${methodId})`);
        console.log(`   Occurrences: ${methodCount.count}`);
        console.log(
          `   Block span: ${blockSpan} (${methodCount.firstBlock} → ${blockNumber})`
        );
        console.log(`   Gas: ${Number(tx.maxFeePerGas || 0n) / 1e9} gwei`);
        console.log(
          `   Priority: ${Number(tx.maxPriorityFeePerGas || 0n) / 1e9} gwei`
        );
        console.log("   ----------------------------------------\n");
      }
    }
  }

  processBlock(block: { transactions: Transaction[] }, blockNumber: bigint) {
    console.log("\n============================================");
    console.log(`🆕 Block #${blockNumber}`);
    console.log(`📊 Transactions: ${block.transactions.length}`);
    console.log("============================================\n");

    this.cleanupOldActivities(blockNumber);
    block.transactions.forEach((tx) =>
      this.processTransaction(tx, blockNumber)
    );
  }
}

const client = createPublicClient({
  chain: base,
  transport: webSocket(webSocketUrl),
});

async function watchTransactions(config: Partial<Config> = {}) {
  const monitor = new TransactionMonitor(config);

  try {
    console.log("🔍 Monitoring transactions to detect spam...");

    const unwatch = await client.watchBlocks({
      onBlock: async (block) => {
        console.log("\n-----------------------------------");
        console.log(`🆕 New block #${block.number}`);
        console.log("-----------------------------------");

        const blockWithTransactions = await client.getBlock({
          blockNumber: block.number,
          includeTransactions: true,
        });

        monitor.processBlock(blockWithTransactions as any, block.number);
      },
      onError: (error) => {
        console.error("❌ Error:", error);
      },
    });

    process.on("SIGINT", () => {
      console.log("Stopping monitoring...");
      unwatch();
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

watchTransactions({
  blockRange: DEFAULT_CONFIG.blockRange,
  minConsecutiveBlocks: DEFAULT_CONFIG.minConsecutiveBlocks,
});
