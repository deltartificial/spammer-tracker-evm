import { createPublicClient, webSocket, hexToString, formatEther } from "viem";
import {
  type Transaction,
  type AddressActivity,
  type Methods,
  type TokenInfo,
  ERC20_TOTAL_SUPPLY,
  type CustomError,
  type AppConfig,
} from "./types";
import { base } from "viem/chains";
import methodsJson from "../methods.json";
import config from "../config.json";

const methods: Methods = methodsJson;

class TransactionMonitor {
  private addressActivities: Map<string, AddressActivity> = new Map();
  private methodIds: string[];
  private config: AppConfig;

  constructor() {
    this.config = config;
    this.methodIds = Object.keys(methods);
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

  private async checkIfERC20(address: string): Promise<[boolean, string]> {
    try {
      if (this.config.ignoredERC20.includes(address.toLowerCase())) {
        return [false, ""];
      }

      const code = await client.getBytecode({
        address: address as `0x${string}`,
      });

      if (!code || code === "0x") return [false, ""];

      const result = await client.call({
        to: address as `0x${string}`,
        data: ERC20_TOTAL_SUPPLY as `0x${string}`,
      });

      const hexValue =
        typeof result === "string" ? result : (result as any).data;
      if (!hexValue || hexValue === "0x") return [false, ""];

      const totalSupply = BigInt(hexValue);
      return [totalSupply > 0n, formatEther(totalSupply)];
    } catch {
      return [false, ""];
    }
  }

  private extractAddressesFromData(data: string): string[] {
    const addresses: string[] = [];
    const cleanData = data.slice(10);

    for (let i = 0; i < cleanData.length; i += 64) {
      const word = cleanData.slice(i, i + 64);
      const potentialAddress = "0x" + word.slice(24);

      if (
        /^0x[a-fA-F0-9]{40}$/.test(potentialAddress) &&
        potentialAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        addresses.push(potentialAddress.toLowerCase());
      }
    }

    return [...new Set(addresses)];
  }

  private async analyzeTokens(data: string): Promise<TokenInfo[]> {
    const addresses = this.extractAddressesFromData(data);
    const tokens: TokenInfo[] = [];

    for (const address of addresses) {
      const [isERC20] = await this.checkIfERC20(address);
      if (isERC20) {
        tokens.push({ address, isERC20 });
      }
    }

    return tokens;
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
          console.log(`   Method: ${methods[methodId]} (${methodId})`);
          console.log(`   Occurrences: ${methodCount.count}`);
          console.log(
            `   Block span: ${blockSpan} (${methodCount.firstBlock} → ${blockNumber})`
          );
          console.log(`   Gas: ${Number(tx.maxFeePerGas || 0n) / 1e9} gwei`);
          console.log(
            `   Priority: ${Number(tx.maxPriorityFeePerGas || 0n) / 1e9} gwei`
          );

          const tokens = await this.analyzeTokens(tx.input);
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
      const err = error as CustomError;
      console.log(`⚠️ Error processing block ${blockNumber}:`, err.message);
    }
  }
}

const client = createPublicClient({
  chain: base,
  transport: webSocket(config.webSocket.url),
});

async function watchTransactions() {
  const monitor = new TransactionMonitor();
  let retryCount = 0;

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function setupWebSocket() {
    try {
      console.log("🔍 Monitoring transactions to detect spam...");

      const unwatch = await client.watchBlocks({
        onBlock: async (block) => {
          try {
            const blockWithTransactions = await client.getBlock({
              blockNumber: block.number,
              includeTransactions: true,
            });

            await monitor.processBlock(
              blockWithTransactions as any,
              block.number
            );
            retryCount = 0;
          } catch (error) {
            console.log(
              `⚠️ Error processing block ${block.number}:`,
              (error as Error).message
            );
          }
        },
        onError: async (error) => {
          console.log("⚠️ WebSocket error:", error.message);
          if (retryCount < config.webSocket.maxRetries) {
            retryCount++;
            console.log(
              `🔄 Reconnecting... (attempt ${retryCount}/${config.webSocket.maxRetries})`
            );
            await sleep(config.webSocket.retryDelay * retryCount);
            setupWebSocket();
          }
        },
      });

      process.on("SIGINT", () => {
        console.log("Stopping monitoring...");
        unwatch();
        process.exit(0);
      });
    } catch (error: unknown) {
      console.log("⚠️ Connection error:", (error as Error).message);
      if (retryCount < config.webSocket.maxRetries) {
        retryCount++;
        console.log(
          `🔄 Retrying connection... (attempt ${retryCount}/${config.webSocket.maxRetries})`
        );
        await sleep(config.webSocket.retryDelay * retryCount);
        setupWebSocket();
      }
    }
  }

  setupWebSocket();
}

watchTransactions();
