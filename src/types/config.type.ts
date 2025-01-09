export interface WebSocketConfig {
  url: string;
  maxRetries: number;
  retryDelay: number;
}

export interface MonitorConfig {
  blockRange: number;
  minConsecutiveBlocks: number;
}

export interface AppConfig {
  webSocket: WebSocketConfig;
  monitor: MonitorConfig;
  ignoredERC20: string[];
}
