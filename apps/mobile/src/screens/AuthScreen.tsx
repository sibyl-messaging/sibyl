import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { Buffer } from "buffer";
import { generateX25519KeyPair } from "@sibyl/protocol";
import nacl from "tweetnacl";

import { saveDeviceCredentials } from "../store/persistence";
import { TransportClient } from "../services/transportClient";
import { nextDeviceId } from "../utils/ids";
import type { AuthSession, DeviceCredentials } from "../types/app";

interface AuthScreenProps {
  initialCredentials: DeviceCredentials | null;
  onAuthenticated: (args: {
    credentials: DeviceCredentials;
    session: AuthSession;
    transport: TransportClient;
  }) => void;
}

export function AuthScreen({
  initialCredentials,
  onAuthenticated
}: AuthScreenProps) {
  const [relayUrl, setRelayUrl] = useState(
    initialCredentials?.relayUrl ?? "http://localhost:8080"
  );
  const [username, setUsername] = useState(initialCredentials?.username ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initialCredentials) {
      return;
    }

    setRelayUrl(initialCredentials.relayUrl);
    setUsername(initialCredentials.username);
  }, [initialCredentials]);

  const canSubmit = useMemo(
    () => relayUrl.length > 0 && username.trim().length >= 3,
    [relayUrl, username]
  );

  const handleAuthenticate = async () => {
    if (!canSubmit || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const normalizedUsername = username.trim().toLowerCase();
      let credentials = initialCredentials;

      if (
        !credentials ||
        credentials.username !== normalizedUsername ||
        credentials.relayUrl !== relayUrl.trim()
      ) {
        const signing = nacl.sign.keyPair();
        const x25519 = generateX25519KeyPair();

        credentials = {
          relayUrl: relayUrl.trim(),
          username: normalizedUsername,
          deviceId: nextDeviceId(),
          signingPublicKey: toBase64(signing.publicKey),
          signingSecretKey: toBase64(signing.secretKey),
          x25519PublicKey: toBase64(x25519.publicKey),
          x25519PrivateKey: toBase64(x25519.privateKey)
        };
      }

      const transport = new TransportClient(credentials.relayUrl);
      await transport.registerUser({
        username: credentials.username,
        deviceId: credentials.deviceId,
        signingPublicKey: credentials.signingPublicKey,
        x25519PublicKey: credentials.x25519PublicKey
      });

      const challenge = await transport.createChallenge(
        credentials.username,
        credentials.deviceId
      );

      const signature = nacl.sign.detached(
        fromBase64(challenge.nonce),
        fromBase64(credentials.signingSecretKey)
      );

      const session = await transport.verifyChallenge(
        challenge.challengeId,
        toBase64(signature)
      );

      await saveDeviceCredentials(credentials);

      onAuthenticated({
        credentials,
        session,
        transport
      });
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Authentication failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sibyl Authentication</Text>
      <Text style={styles.label}>Relay URL</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        value={relayUrl}
        onChangeText={setRelayUrl}
      />
      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, !canSubmit || busy ? styles.buttonDisabled : null]}
        onPress={handleAuthenticate}
        disabled={!canSubmit || busy}
      >
        {busy ? (
          <ActivityIndicator color="#f8fafc" />
        ) : (
          <Text style={styles.buttonText}>Authenticate</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: "#f1f5f9"
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 20,
    color: "#020617"
  },
  label: {
    fontSize: 13,
    color: "#334155",
    marginBottom: 4,
    marginTop: 8
  },
  input: {
    borderWidth: 1,
    borderColor: "#94a3b8",
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  button: {
    marginTop: 16,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a"
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: "#f8fafc",
    fontWeight: "700"
  },
  error: {
    marginTop: 10,
    color: "#dc2626"
  }
});

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}
