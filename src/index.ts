import { createPublicClient, webSocket, type PublicClient } from "viem";
import { base } from "viem/chains";
import methodsJson from "../methods.json";
import config from "../config.json";
import { TransactionMonitor } from "./services/transaction-monitor.service";
import { WebSocketService } from "./services/websocket.service";

const client = createPublicClient({
  chain: base,
  transport: webSocket(config.webSocket.url),
}) as PublicClient;

const monitor = new TransactionMonitor(client, config, methodsJson);
const wsService = new WebSocketService(client, config, monitor);

wsService.start();
