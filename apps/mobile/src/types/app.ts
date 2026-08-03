import type { EncryptedEnvelope, TokenStream } from "@sibyl/protocol";

export interface DeviceCredentials {
  relayUrl: string;
  username: string;
  deviceId: string;
  signingPublicKey: string;
  signingSecretKey: string;
  x25519PublicKey: string;
  x25519PrivateKey: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  auth: {
    userId: string;
    username: string;
    deviceId: string;
  };
}

export interface ConversationContext {
  conversationId: string;
  status: "pending" | "active";
  recipientUsername: string;
  recipientDeviceId: string;
  recipientX25519PublicKey: string;
}

export interface InboundEnvelopeEvent {
  envelope: EncryptedEnvelope;
  tokenStream: TokenStream;
}
