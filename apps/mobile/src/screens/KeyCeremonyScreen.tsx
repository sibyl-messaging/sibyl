import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";

import {
  deriveConversationHoleMap,
  generateMasterSeedShares,
  reconstructSeedFromShares
} from "../services/keyCeremony";

interface KeyCeremonyScreenProps {
  conversationId: string | null;
}

export function KeyCeremonyScreen({ conversationId }: KeyCeremonyScreenProps) {
  const [share1, setShare1] = useState("");
  const [share2, setShare2] = useState("");
  const [share3, setShare3] = useState("");
  const [derivedHoles, setDerivedHoles] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedShares, setGeneratedShares] = useState<[string, string, string] | null>(
    null
  );

  const reconstruct = async () => {
    if (!conversationId) {
      setError("Create or accept a conversation first");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const seed = await reconstructSeedFromShares([share1, share2, share3]);
      const holes = await deriveConversationHoleMap(seed, conversationId);
      setDerivedHoles(holes);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Ceremony failed";
      setError(message);
      setDerivedHoles(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Key Ceremony (3-of-3)</Text>
      <Text style={styles.caption}>
        Scan or paste all 3 shares. Seed is reconstructed transiently and zeroized.
      </Text>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => {
          const generated = generateMasterSeedShares();
          setGeneratedShares(generated.shares);
          setShare1(generated.shares[0]);
          setShare2(generated.shares[1]);
          setShare3(generated.shares[2]);
        }}
      >
        <Text style={styles.secondaryButtonText}>Generate 3-of-3 Shares</Text>
      </TouchableOpacity>

      {generatedShares ? (
        <View style={styles.generatedContainer}>
          <Text style={styles.generatedLabel}>Generated Share 1:</Text>
          <Text style={styles.generatedValue}>{generatedShares[0]}</Text>
          <Text style={styles.generatedLabel}>Generated Share 2:</Text>
          <Text style={styles.generatedValue}>{generatedShares[1]}</Text>
          <Text style={styles.generatedLabel}>Generated Share 3:</Text>
          <Text style={styles.generatedValue}>{generatedShares[2]}</Text>
        </View>
      ) : null}

      <TextInput style={styles.input} value={share1} onChangeText={setShare1} />
      <TextInput style={styles.input} value={share2} onChangeText={setShare2} />
      <TextInput style={styles.input} value={share3} onChangeText={setShare3} />

      <TouchableOpacity style={styles.button} onPress={reconstruct}>
        {busy ? (
          <ActivityIndicator color="#f9fafb" />
        ) : (
          <Text style={styles.buttonText}>Reconstruct Sheet Map</Text>
        )}
      </TouchableOpacity>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {derivedHoles ? (
        <View style={styles.results}>
          <Text style={styles.resultsLabel}>Derived Hole IDs</Text>
          <Text style={styles.resultsValue}>{derivedHoles.join(", ")}</Text>
        </View>
      ) : null}
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
    color: "#334155"
  },
  input: {
    marginTop: 10,
    borderRadius: 8,
    borderColor: "#94a3b8",
    borderWidth: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  button: {
    marginTop: 12,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827"
  },
  buttonText: {
    color: "#f9fafb",
    fontWeight: "700"
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 10,
    alignItems: "center"
  },
  secondaryButtonText: {
    color: "#0f172a",
    fontWeight: "700"
  },
  generatedContainer: {
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    padding: 8,
    backgroundColor: "#f8fafc"
  },
  generatedLabel: {
    marginTop: 6,
    color: "#334155",
    fontWeight: "700"
  },
  generatedValue: {
    color: "#334155"
  },
  error: {
    color: "#dc2626",
    marginTop: 8
  },
  results: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#f8fafc"
  },
  resultsLabel: {
    fontWeight: "700",
    color: "#0f172a"
  },
  resultsValue: {
    marginTop: 4,
    color: "#334155"
  }
});
