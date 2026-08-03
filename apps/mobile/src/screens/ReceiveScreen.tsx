import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { TokenStream } from "@sibyl/protocol";

import { ControlPad } from "../components/ControlPad";
import { GhostGrid } from "../components/GhostGrid";
import {
  enableScreenSecurity,
  restoreScreenSecurity
} from "../services/securityRuntime";
import { buildGhostBitmap } from "../utils/ghostBitmap";

interface ReceiveScreenProps {
  tokenStream: TokenStream | null;
}

export function ReceiveScreen({ tokenStream }: ReceiveScreenProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [strobeEnabled, setStrobeEnabled] = useState(false);

  useEffect(() => {
    void enableScreenSecurity();

    return () => {
      void restoreScreenSecurity();
    };
  }, []);

  useEffect(() => {
    if (!strobeEnabled) {
      return;
    }

    const interval = setInterval(() => {
      setOffsetX((value) => (value === 0 ? 1 : 0));
    }, 140);

    return () => clearInterval(interval);
  }, [strobeEnabled]);

  const bitmap = useMemo(
    () =>
      buildGhostBitmap({
        tokens: tokenStream?.tokens ?? [],
        noiseSeed: tokenStream?.createdAtMs ?? Date.now()
      }),
    [tokenStream]
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ghost Receive</Text>
      <Text style={styles.body}>
        Align your Ghost Sheet over the panel and adjust until alignment marks match.
      </Text>

      <GhostGrid bitmap={bitmap} offsetX={offsetX} offsetY={offsetY} />

      <ControlPad
        onMove={(dx, dy) => {
          setOffsetX((value) => value + dx);
          setOffsetY((value) => value + dy);
        }}
      />

      <TouchableOpacity
        style={styles.strobeButton}
        onPress={() => setStrobeEnabled((value) => !value)}
      >
        <Text style={styles.strobeButtonText}>
          {strobeEnabled ? "Disable Strobe" : "Enable Strobe"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.meta}>
        Last stream size: {tokenStream?.tokens.length ?? 0} tokens
      </Text>
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
  body: {
    marginTop: 6,
    color: "#374151"
  },
  strobeButton: {
    marginTop: 12,
    height: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827"
  },
  strobeButtonText: {
    color: "#f9fafb",
    fontWeight: "700"
  },
  meta: {
    marginTop: 8,
    color: "#6b7280"
  }
});
