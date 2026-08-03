import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  createTokenStream,
  generateBlindInputMapping,
  resolveCodeToHoleId,
  type EncryptedEnvelope
} from "@sibyl/protocol";

import { DigitPad } from "../components/DigitPad";
import { NumberGrid } from "../components/NumberGrid";
import { encryptEnvelopeOnDevice } from "../services/sessionCrypto";
import { ACTIVE_HOLE_IDS } from "../utils/holeMap";

interface ComposeScreenProps {
  conversationId: string;
  senderDeviceId: string;
  recipientPublicKey: string;
  onEnvelopeReady: (envelope: EncryptedEnvelope) => void;
}

export function ComposeScreen({
  conversationId,
  senderDeviceId,
  recipientPublicKey,
  onEnvelopeReady
}: ComposeScreenProps) {
  const [mapping, setMapping] = useState(() =>
    generateBlindInputMapping(ACTIVE_HOLE_IDS)
  );
  const [buffer, setBuffer] = useState("");
  const [tokens, setTokens] = useState<number[]>([]);

  const tokenRemaining = 280 - tokens.length;

  const displayHelp = useMemo(() => {
    if (buffer.length === 0) {
      return "Enter 2 digits for the target hole";
    }
    return `Pending code: ${buffer}`;
  }, [buffer]);

  const appendDigit = (digit: string) => {
    if (buffer.length >= 2) {
      return;
    }

    const next = `${buffer}${digit}`;
    setBuffer(next);

    if (next.length === 2) {
      const holeId = resolveCodeToHoleId(mapping, next);
      if (holeId !== null && tokenRemaining > 0) {
        setTokens((prev) => [...prev, holeId]);
      }

      setMapping((prev) =>
        generateBlindInputMapping(ACTIVE_HOLE_IDS, prev.generation)
      );
      setBuffer("");
    }
  };

  const send = () => {
    if (tokens.length === 0) {
      return;
    }

    const tokenStream = createTokenStream({
      conversationId,
      tokens
    });

    const envelope = encryptEnvelopeOnDevice({
      conversationId,
      senderDeviceId,
      tokenStream,
      recipientStaticPublicKeyBase64: recipientPublicKey
    });

    onEnvelopeReady(envelope);
    setTokens([]);
    setBuffer("");
    setMapping((prev) =>
      generateBlindInputMapping(ACTIVE_HOLE_IDS, prev.generation)
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blind Compose</Text>
      <Text style={styles.caption}>{displayHelp}</Text>
      <Text style={styles.caption}>Tokens remaining: {tokenRemaining}</Text>
      <Text style={styles.warning}>Cover the front camera before typing.</Text>

      <NumberGrid codeByHoleId={mapping.codeByHoleId} generation={mapping.generation} />

      <DigitPad
        onDigit={appendDigit}
        onBackspace={() => setBuffer((prev) => prev.slice(0, -1))}
        onClear={() => {
          setBuffer("");
          setTokens([]);
          setMapping((prev) =>
            generateBlindInputMapping(ACTIVE_HOLE_IDS, prev.generation)
          );
        }}
      />

      <TouchableOpacity style={styles.sendButton} onPress={send}>
        <Text style={styles.sendButtonText}>Send Token Stream</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827"
  },
  caption: {
    marginTop: 4,
    color: "#374151"
  },
  warning: {
    marginTop: 8,
    color: "#b45309",
    fontWeight: "600"
  },
  sendButton: {
    marginTop: 16,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center"
  },
  sendButtonText: {
    color: "#f8fafc",
    fontWeight: "700"
  }
});
