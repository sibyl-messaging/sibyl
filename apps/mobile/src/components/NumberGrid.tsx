import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { HOLE_GRID_HEIGHT, HOLE_GRID_WIDTH } from "@sibyl/protocol";

interface NumberGridProps {
  codeByHoleId: Record<string, string>;
  generation: number;
}

export function NumberGrid({ codeByHoleId, generation }: NumberGridProps) {
  const fallbackCodes = useMemo(() => {
    const total = HOLE_GRID_HEIGHT * HOLE_GRID_WIDTH;
    const codes: string[] = [];
    let seed = generation || Date.now();

    for (let i = 0; i < total; i += 1) {
      seed = xorshift(seed + i);
      codes.push(String(seed % 100).padStart(2, "0"));
    }

    return codes;
  }, [generation]);

  return (
    <View style={styles.container}>
      {Array.from({ length: HOLE_GRID_HEIGHT }).map((_, row) => (
        <View key={`row-${row}`} style={styles.row}>
          {Array.from({ length: HOLE_GRID_WIDTH }).map((__, col) => {
            const holeId = row * HOLE_GRID_WIDTH + col;
            const code = codeByHoleId[String(holeId)] ?? fallbackCodes[holeId] ?? "00";
            const isSignal = codeByHoleId[String(holeId)] !== undefined;

            return (
              <View
                key={`cell-${holeId}`}
                style={[styles.cell, isSignal ? styles.signalCell : styles.noiseCell]}
              >
                <Text style={styles.code}>{code}</Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 4,
    backgroundColor: "#e5e7eb"
  },
  row: {
    flexDirection: "row"
  },
  cell: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    margin: 1
  },
  signalCell: {
    backgroundColor: "#111827"
  },
  noiseCell: {
    backgroundColor: "#6b7280"
  },
  code: {
    fontSize: 10,
    fontWeight: "700",
    color: "#f9fafb"
  }
});

function xorshift(value: number): number {
  let x = value || 2463534242;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}
