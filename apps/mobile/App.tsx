import { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  stampBundleDescriptorSchema,
  stampHelperSlotSchema,
  type EncryptedEnvelope,
  type TokenStream
} from "@sibyl/protocol";
import { z } from "zod";

import { AuthScreen } from "./src/screens/AuthScreen";
import { ComposeScreen } from "./src/screens/ComposeScreen";
import {
  PrepareStampsScreen,
  type StampPreparationSetup
} from "./src/screens/PrepareStampsScreen";
import { PunchCardDemoScreen } from "./src/screens/PunchCardDemoScreen";
import { ReceiveScreen } from "./src/screens/ReceiveScreen";
import { decryptEnvelopeOnDevice } from "./src/services/sessionCrypto";
import {
  type WsEventFrame,
  TransportClient
} from "./src/services/transportClient";
import {
  loadDeviceCredentials
} from "./src/store/persistence";
import type {
  AuthSession,
  ConversationContext,
  DeviceCredentials
} from "./src/types/app";

type ActiveTab = "compose" | "receive";
type AppMode = "chooser" | "demo" | "full";

interface PendingInvite {
  conversationId: string;
  fromUsername: string;
}

const stampBundleProposalSchema = z.object({
  descriptor: stampBundleDescriptorSchema,
  helperSlots: z.array(stampHelperSlotSchema)
});

const stampBundleUpdateSchema = z.object({
  descriptor: stampBundleDescriptorSchema,
  pairId: z.string().nullable(),
  shareIndex: z.number().int().nullable(),
  pairState: z.string()
});

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>("chooser");
  const [initialCredentials, setInitialCredentials] =
    useState<DeviceCredentials | null>(null);
  const [credentials, setCredentials] = useState<DeviceCredentials | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [transport, setTransport] = useState<TransportClient | null>(null);

  const [recipientUsername, setRecipientUsername] = useState("");
  const [conversation, setConversation] = useState<ConversationContext | null>(null);
  const [lastInbound, setLastInbound] = useState<TokenStream | null>(null);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("compose");
  const [statusText, setStatusText] = useState<string>("Idle");
  const [stampSetup, setStampSetup] = useState<StampPreparationSetup | null>(null);
  const [showStampPreparation, setShowStampPreparation] = useState(false);

  useEffect(() => {
    void (async () => {
      const savedCredentials = await loadDeviceCredentials();
      setInitialCredentials(savedCredentials);
    })();
  }, []);

  useEffect(() => {
    if (!session || !transport || !credentials) {
      return;
    }

    transport.connectSocket(session.accessToken, (frame) => {
      void handleWsFrame(frame, credentials, transport);
    });

    const syncTimer = setTimeout(() => {
      transport.sendWsEvent("queue.sync", {});
    }, 400);

    return () => {
      clearTimeout(syncTimer);
      transport.closeSocket();
    };
  }, [session, transport, credentials]);

  const ready = useMemo(
    () => credentials !== null && session !== null && transport !== null,
    [credentials, session, transport]
  );

  if (appMode === "demo") {
    return <PunchCardDemoScreen onExit={() => setAppMode("chooser")} />;
  }

  if (appMode === "chooser") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.launcherContainer}>
          <View style={styles.launcherCard}>
            <Text style={styles.heading}>Sibyl</Text>
            <Text style={styles.subheading}>
              Pick one mode. Demo skips auth/network and tests punch-card UX only.
            </Text>

            <TouchableOpacity
              style={styles.button}
              onPress={() => setAppMode("demo")}
            >
              <Text style={styles.buttonText}>Punch Card Demo (No Network)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryLaunchButton}
              onPress={() => setAppMode("full")}
            >
              <Text style={styles.secondaryLaunchButtonText}>
                Full Messaging Flow
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!ready) {
    return (
      <AuthScreen
        initialCredentials={initialCredentials}
        onAuthenticated={({ credentials: nextCredentials, session: nextSession, transport: nextTransport }) => {
          setCredentials(nextCredentials);
          setSession(nextSession);
          setTransport(nextTransport);
          setStatusText("Authenticated");
        }}
      />
    );
  }

  const activeCredentials = credentials;
  const activeTransport = transport;
  if (!activeCredentials || !activeTransport) {
    return null;
  }

  const startConversation = async () => {
    if (!activeTransport || !session || recipientUsername.trim().length < 3) {
      return;
    }

    try {
      setStatusText("Resolving recipient");
      const lookup = await activeTransport.lookupUser(
        session.accessToken,
        recipientUsername.trim().toLowerCase()
      );

      if (!lookup.devices[0]) {
        throw new Error("Recipient has no registered device key");
      }

      const created = await activeTransport.createConversation(
        session.accessToken,
        lookup.username
      );

      setConversation({
        conversationId: created.conversationId,
        status: created.status === "active" ? "active" : "pending",
        recipientUsername: lookup.username,
        recipientDeviceId: lookup.devices[0].id,
        recipientX25519PublicKey: lookup.devices[0].x25519PublicKey
      });

      setStatusText(`Conversation ${created.status}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Conversation failed";
      setStatusText(message);
    }
  };

  const acceptInvite = async (invite: PendingInvite) => {
    if (!activeTransport || !session) {
      return;
    }

    activeTransport.sendWsEvent("conversation.accept", {
      conversationId: invite.conversationId
    });

    try {
      const lookup = await activeTransport.lookupUser(
        session.accessToken,
        invite.fromUsername
      );
      if (!lookup.devices[0]) {
        return;
      }

      setConversation({
        conversationId: invite.conversationId,
        status: "active",
        recipientUsername: invite.fromUsername,
        recipientDeviceId: lookup.devices[0].id,
        recipientX25519PublicKey: lookup.devices[0].x25519PublicKey
      });
      setPendingInvites((prev) =>
        prev.filter((item) => item.conversationId !== invite.conversationId)
      );
      setStatusText("Invite accepted");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Invite accept failed";
      setStatusText(message);
    }
  };

  async function handleWsFrame(
    frame: WsEventFrame,
    creds: DeviceCredentials,
    client: TransportClient
  ): Promise<void> {
    switch (frame.event) {
      case "conversation.invite": {
        const payload = frame.data as {
          conversationId: string;
          fromUsername: string;
        };

        setPendingInvites((prev) => {
          if (prev.some((item) => item.conversationId === payload.conversationId)) {
            return prev;
          }

          return [...prev, payload];
        });
        setStatusText("Incoming invite");
        break;
      }
      case "conversation.accept": {
        const payload = frame.data as { conversationId?: string; status?: string };
        if (payload.conversationId) {
          setConversation((prev) => {
            if (!prev || prev.conversationId !== payload.conversationId) {
              return prev;
            }
            return {
              ...prev,
              status: payload.status === "active" ? "active" : "pending"
            };
          });
        }
        setStatusText(
          payload.status === "active" ? "Conversation active" : "Conversation pending"
        );
        break;
      }
      case "message.envelope": {
        const envelope = frame.data as EncryptedEnvelope;
        const tokenStream = decryptEnvelopeOnDevice({
          envelope,
          recipientStaticPrivateKeyBase64: creds.x25519PrivateKey
        });
        setLastInbound(tokenStream);
        client.sendWsEvent("message.ack", {
          envelopeId: envelope.envelopeId
        });
        setStatusText("Ghost message received");
        break;
      }
      case "message.ack": {
        setStatusText("Ghost message queued");
        break;
      }
      case "queue.sync": {
        break;
      }
      case "stamp.bundle.proposed": {
        const proposal = stampBundleProposalSchema.parse(frame.data);
        setStampSetup(proposal);
        setShowStampPreparation(true);
        setStatusText("Make matching stamps");
        break;
      }
      case "stamp.bundle.updated": {
        const update = stampBundleUpdateSchema.parse(frame.data);
        setStampSetup((previous) =>
          previous?.descriptor.bundleId === update.descriptor.bundleId
            ? { ...previous, descriptor: update.descriptor }
            : previous
        );
        break;
      }
      default:
        break;
    }
  }

  if (showStampPreparation && conversation && session) {
    return (
      <PrepareStampsScreen
        accessToken={session.accessToken}
        conversationId={conversation.conversationId}
        recipientUsername={conversation.recipientUsername}
        transport={activeTransport}
        initialSetup={stampSetup}
        onSetupCreated={(created) => setStampSetup(created)}
        onClose={() => setShowStampPreparation(false)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Text style={styles.heading}>Sibyl Ghost Messaging</Text>
        <Text style={styles.subheading}>Status: {statusText}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Conversation</Text>
          <TextInput
            style={styles.input}
            placeholder="recipient username"
            autoCapitalize="none"
            value={recipientUsername}
            onChangeText={setRecipientUsername}
          />
          <TouchableOpacity style={styles.button} onPress={startConversation}>
            <Text style={styles.buttonText}>Start / Refresh Conversation</Text>
          </TouchableOpacity>

          {conversation ? (
            <>
              <Text style={styles.infoText}>
                Conversation with {conversation.recipientUsername} ({conversation.status})
              </Text>
              {conversation.status === "active" ? (
                <TouchableOpacity
                  style={styles.stampButton}
                  onPress={() => setShowStampPreparation(true)}
                >
                  <Text style={styles.stampButtonText}>
                    {stampSetup ? "Continue matching stamps" : "Make matching stamps"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <Text style={styles.infoText}>No active conversation</Text>
          )}
        </View>

        {pendingInvites.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pending Invites</Text>
            {pendingInvites.map((invite) => (
              <TouchableOpacity
                key={invite.conversationId}
                style={styles.inviteButton}
                onPress={() => void acceptInvite(invite)}
              >
                <Text style={styles.inviteButtonText}>
                  Accept {invite.fromUsername} ({invite.conversationId})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <View style={styles.tabRow}>
          {([
            ["compose", "Compose"],
            ["receive", "Receive"]
          ] as const).map(([tabId, label]) => (
            <TouchableOpacity
              key={tabId}
              onPress={() => setActiveTab(tabId)}
              style={[
                styles.tabButton,
                activeTab === tabId ? styles.tabButtonActive : null
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tabId ? styles.tabTextActive : null
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.card}>
          {activeTab === "compose" &&
          conversation &&
          conversation.status === "active" ? (
              <ComposeScreen
                conversationId={conversation.conversationId}
                senderDeviceId={activeCredentials.deviceId}
                recipientPublicKey={conversation.recipientX25519PublicKey}
                onEnvelopeReady={(envelope) => {
                  activeTransport.sendWsEvent("message.envelope", envelope);
                  setStatusText("Envelope sent");
                }}
              />
          ) : null}

          {activeTab === "compose" &&
          conversation &&
          conversation.status !== "active" ? (
            <Text style={styles.infoText}>
              Waiting for recipient acceptance before sending.
            </Text>
          ) : null}

          {activeTab === "compose" && !conversation ? (
            <Text style={styles.infoText}>Start or accept a conversation first.</Text>
          ) : null}

          {activeTab === "receive" ? (
            <ReceiveScreen tokenStream={lastInbound} />
          ) : null}

        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8fafc"
  },
  scrollContainer: {
    padding: 16,
    gap: 12
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a"
  },
  subheading: {
    color: "#334155"
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    padding: 12
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e293b",
    marginBottom: 8
  },
  input: {
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  button: {
    marginTop: 8,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center"
  },
  buttonText: {
    color: "#f8fafc",
    fontWeight: "700"
  },
  infoText: {
    marginTop: 8,
    color: "#475569"
  },
  inviteButton: {
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: "#1e293b",
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  inviteButtonText: {
    color: "#f8fafc",
    fontWeight: "600"
  },
  stampButton: {
    minHeight: 52,
    marginTop: 12,
    borderWidth: 2,
    borderColor: "#17201b",
    backgroundColor: "#1f6b4f",
    alignItems: "center",
    justifyContent: "center"
  },
  stampButtonText: {
    color: "#fffdf7",
    fontSize: 16,
    fontWeight: "800"
  },
  tabRow: {
    flexDirection: "row",
    gap: 8
  },
  tabButton: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#94a3b8",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1f5f9"
  },
  tabButtonActive: {
    backgroundColor: "#111827",
    borderColor: "#111827"
  },
  tabText: {
    color: "#0f172a",
    fontWeight: "600"
  },
  tabTextActive: {
    color: "#f9fafb"
  },
  launcherContainer: {
    flex: 1,
    justifyContent: "center",
    padding: 16
  },
  launcherCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 10
  },
  secondaryLaunchButton: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#94a3b8",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryLaunchButtonText: {
    color: "#0f172a",
    fontWeight: "700"
  }
});
