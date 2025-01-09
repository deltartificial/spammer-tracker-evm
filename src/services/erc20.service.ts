import { type PublicClient } from "viem";
import { formatEther } from "viem";
import { ERC20_TOTAL_SUPPLY, type TokenInfo } from "../types";
import { extractAddressesFromData } from "../utils/address.utils";
import { type AppConfig } from "../types";

export class ERC20Service {
  constructor(
    private readonly client: PublicClient,
    private readonly config: AppConfig
  ) {}

  async checkIfERC20(address: string): Promise<[boolean, string]> {
    try {
      if (this.config.ignoredERC20.includes(address.toLowerCase())) {
        return [false, ""];
      }

      const code = await this.client.getBytecode({
        address: address as `0x${string}`,
      });

      if (!code || code === "0x") return [false, ""];

      const result = await this.client.call({
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

  async analyzeTokens(data: string): Promise<TokenInfo[]> {
    const addresses = extractAddressesFromData(data);
    const tokens: TokenInfo[] = [];

    for (const address of addresses) {
      const [isERC20] = await this.checkIfERC20(address);
      if (isERC20) {
        tokens.push({ address, isERC20 });
      }
    }

    return tokens;
  }
}
