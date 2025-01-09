import type { PublicClient } from "viem";
import type { AppConfig, Transaction } from "../types";
import type { TransactionMonitor } from "./transaction-monitor.service";

export class WebSocketService {
  private retryCount = 0;

  constructor(
    private readonly client: PublicClient,
    private readonly config: AppConfig,
    private readonly monitor: TransactionMonitor
  ) {}

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async start(): Promise<void> {
    try {
      console.log("🔍 Monitoring transactions to detect spam...");

      const unwatch = await this.client.watchBlocks({
        onBlock: async (block) => {
          try {
            const blockWithTransactions = await this.client.getBlock({
              blockNumber: block.number,
              includeTransactions: true,
            });

            await this.monitor.processBlock(
              {
                transactions:
                  blockWithTransactions.transactions as unknown as Transaction[],
              },
              block.number
            );
            this.retryCount = 0;
          } catch (error) {
            console.log(
              `⚠️ Error processing block ${block.number}:`,
              (error as Error).message
            );
          }
        },
        onError: async (error) => {
          console.log("⚠️ WebSocket error:", error.message);
          if (this.retryCount < this.config.webSocket.maxRetries) {
            this.retryCount++;
            console.log(
              `🔄 Reconnecting... (attempt ${this.retryCount}/${this.config.webSocket.maxRetries})`
            );
            await this.sleep(
              this.config.webSocket.retryDelay * this.retryCount
            );
            this.start();
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
      if (this.retryCount < this.config.webSocket.maxRetries) {
        this.retryCount++;
        console.log(
          `🔄 Retrying connection... (attempt ${this.retryCount}/${this.config.webSocket.maxRetries})`
        );
        await this.sleep(this.config.webSocket.retryDelay * this.retryCount);
        this.start();
      }
    }
  }
}
