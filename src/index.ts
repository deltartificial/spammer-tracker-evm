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
    console.log(
      `   📝 Method detected: ${methods[methodId]} (${methodId}) by ${from}`
    );

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
      console.log(
        `   🔄 Repetition #${currentActivity.methodCounts[methodId].count} of the method`
      );
    }

    currentActivity.lastSeen = Number(blockNumber);
    this.addressActivities.set(from, currentActivity);

    const methodCount = currentActivity.methodCounts[methodId];
    const blockSpan = Number(blockNumber) - methodCount.firstBlock;

    if (methodCount.count > 1 && blockSpan <= this.config.blockRange) {
      if (blockSpan >= this.config.minConsecutiveBlocks) {
        console.log(`🚨 Spam detected from address ${from}:`);
        console.log(`   Method: ${methods[methodId]} (${methodId})`);
        console.log(`   Number of uses: ${methodCount.count}`);
        console.log(
          `   Over ${blockSpan} blocks (from ${methodCount.firstBlock} to ${blockNumber})`
        );
      }
    }
  }

  processBlock(block: { transactions: Transaction[] }, blockNumber: bigint) {
    console.log(`\n📦 Analyzing block ${blockNumber}:`);
    console.log(`   📊 Number of transactions: ${block.transactions.length}`);

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
