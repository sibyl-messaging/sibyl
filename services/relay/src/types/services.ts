import type { AuthService } from "../services/authService.js";
import type { ConversationService } from "../services/conversationService.js";
import type { DirectoryService } from "../services/directoryService.js";
import type { PushService } from "../services/pushService.js";
import type { QueueServiceLike } from "../services/queueService.js";
import type { StampService } from "../services/stampService.js";

export interface ServiceContainer {
  authService: AuthService;
  directoryService: DirectoryService;
  conversationService: ConversationService;
  queueService: QueueServiceLike;
  pushService: PushService;
  stampService: StampService;
}

export interface WsHubLike {
  sendToUser(userId: string, event: string, data: unknown): void;
  isUserOnline(userId: string): boolean;
}
