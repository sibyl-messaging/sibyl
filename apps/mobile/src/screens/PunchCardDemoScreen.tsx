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
import {
  createTokenStream,
  generateBlindInputMapping,
  resolveCodeToHoleId,
  HOLE_GRID_HEIGHT,
  HOLE_GRID_WIDTH
} from "@sibyl/protocol";

import { ControlPad } from "../components/ControlPad";
import { DigitPad } from "../components/DigitPad";
import { GhostGrid } from "../components/GhostGrid";
import { NumberGrid } from "../components/NumberGrid";
import {
  enableScreenSecurity,
  restoreScreenSecurity
} from "../services/securityRuntime";
import { buildGhostBitmap } from "../utils/ghostBitmap";
import {
  ACTIVE_HOLE_IDS,
  HOLE_ID_TO_GLYPH,
  normalizeDemoText,
  textToHoleTokens
} from "../utils/holeMap";

type DemoTab = "sheet" | "read" | "type";

interface PunchCardDemoScreenProps {
  onExit: () => void;
}

export function PunchCardDemoScreen({ onExit }: PunchCardDemoScreenProps) {
  const [tab, setTab] = useState<DemoTab>("sheet");
  const [demoText, setDemoText] = useState("HELLO.");
  const [noiseSeed, setNoiseSeed] = useState(() => Date.now());

  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [strobeEnabled, setStrobeEnabled] = useState(false);

  const [mapping, setMapping] = useState(() =>
    generateBlindInputMapping(ACTIVE_HOLE_IDS)
  );
  const [codeBuffer, setCodeBuffer] = useState("");
  const [decodedText, setDecodedText] = useState("");

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

  const normalizedText = useMemo(() => normalizeDemoText(demoText).slice(0, 280), [
    demoText
  ]);

  const tokenStream = useMemo(
    () =>
      createTokenStream({
        conversationId: "demo_local",
        tokens: textToHoleTokens(normalizedText),
        createdAtMs: noiseSeed
      }),
    [normalizedText, noiseSeed]
  );

  const bitmap = useMemo(
    () =>
      buildGhostBitmap({
        tokens: tokenStream.tokens,
        noiseSeed: tokenStream.createdAtMs
      }),
    [tokenStream]
  );

  const shuffleGrid = () => {
    setMapping((prev) => generateBlindInputMapping(ACTIVE_HOLE_IDS, prev.generation));
  };

  const appendDigit = (digit: string) => {
    if (codeBuffer.length >= 2) {
      return;
    }

    const next = `${codeBuffer}${digit}`;
    setCodeBuffer(next);

    if (next.length === 2) {
      const holeId = resolveCodeToHoleId(mapping, next);
      if (holeId !== null) {
        const glyph = HOLE_ID_TO_GLYPH[holeId];
        if (glyph !== undefined) {
          setDecodedText((prev) => `${prev}${glyph}`.slice(0, 280));
        }
      }

      shuffleGrid();
      setCodeBuffer("");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Punch Card Demo</Text>
          <TouchableOpacity style={styles.exitButton} onPress={onExit}>
            <Text style={styles.exitButtonText}>Back</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.subheading}>
          No network flow. This is only the mask + read + blind input experience.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Demo Message</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            value={demoText}
            onChangeText={setDemoText}
            placeholder="HELLO."
          />
          <Text style={styles.meta}>Normalized: {normalizedText || "(empty)"}</Text>
          <Text style={styles.meta}>Token count: {tokenStream.tokens.length}</Text>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setNoiseSeed(Date.now())}
          >
            <Text style={styles.secondaryButtonText}>Refresh Noise Pattern</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabRow}>
          {([
            ["sheet", "1) Make Mask"],
            ["read", "2) Read"],
            ["type", "3) Type"]
          ] as const).map(([tabId, label]) => (
            <TouchableOpacity
              key={tabId}
              style={[styles.tabButton, tab === tabId ? styles.tabButtonActive : null]}
              onPress={() => setTab(tabId)}
            >
              <Text
                style={[styles.tabText, tab === tabId ? styles.tabTextActive : null]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.card}>
          {tab === "sheet" ? (
            <View>
              <Text style={styles.cardTitle}>Make Negative Mask Sheet</Text>
              <Text style={styles.instructions}>
                Rule: all unlabeled cells must be dark black. All labeled cells
                must stay blank white (no fill). White windows pass light; dark
                areas block light.
              </Text>
              <View style={styles.sheetGrid}>
                {Array.from({ length: HOLE_GRID_HEIGHT }).map((_, row) => (
                  <View key={`sheet-row-${row}`} style={styles.sheetRow}>
                    {Array.from({ length: HOLE_GRID_WIDTH }).map((__, col) => {
                      const holeId = row * HOLE_GRID_WIDTH + col;
                      const glyph = HOLE_ID_TO_GLYPH[holeId];
                      const active = glyph !== undefined;

                      return (
                        <View
                          key={`sheet-cell-${holeId}`}
                          style={[
                            styles.sheetCell,
                            active ? styles.sheetCellActive : styles.sheetCellInactive
                          ]}
                        >
                          <Text
                            style={[
                              styles.sheetCellText,
                              active ? styles.sheetCellTextActive : null
                            ]}
                          >
                            {glyph ?? ""}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {tab === "read" ? (
            <View>
              <Text style={styles.cardTitle}>Read Through Overlay</Text>
              <Text style={styles.instructions}>
                Place your mask on screen. Use controls to align clear windows to
                signal pixels.
              </Text>
              <GhostGrid bitmap={bitmap} offsetX={offsetX} offsetY={offsetY} />
              <ControlPad
                onMove={(dx, dy) => {
                  setOffsetX((value) => value + dx);
                  setOffsetY((value) => value + dy);
                }}
              />
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => setStrobeEnabled((value) => !value)}
              >
                <Text style={styles.primaryButtonText}>
                  {strobeEnabled ? "Disable Strobe" : "Enable Strobe"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {tab === "type" ? (
            <View>
              <Text style={styles.cardTitle}>Blind Input Simulation</Text>
              <Text style={styles.instructions}>
                Find the target glyph window on your mask, then type the 2-digit
                number currently under it.
              </Text>
              <Text style={styles.meta}>Pending code: {codeBuffer || "--"}</Text>
              <Text style={styles.meta}>Decoded output: {decodedText || "(none)"}</Text>

              <NumberGrid
                codeByHoleId={mapping.codeByHoleId}
                generation={mapping.generation}
              />

              <DigitPad
                onDigit={appendDigit}
                onBackspace={() => setCodeBuffer((prev) => prev.slice(0, -1))}
                onClear={() => {
                  setCodeBuffer("");
                  setDecodedText("");
                  shuffleGrid();
                }}
              />

              <TouchableOpacity style={styles.secondaryButton} onPress={shuffleGrid}>
                <Text style={styles.secondaryButtonText}>Manual Shuffle</Text>
              </TouchableOpacity>
            </View>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a"
  },
  subheading: {
    color: "#334155"
  },
  exitButton: {
    borderRadius: 8,
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  exitButtonText: {
    color: "#0f172a",
    fontWeight: "700"
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
  instructions: {
    color: "#475569",
    marginBottom: 8
  },
  meta: {
    marginTop: 6,
    color: "#334155"
  },
  primaryButton: {
    marginTop: 12,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#f9fafb",
    fontWeight: "700"
  },
  secondaryButton: {
    marginTop: 10,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#94a3b8",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc"
  },
  secondaryButtonText: {
    color: "#0f172a",
    fontWeight: "700"
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
    fontWeight: "600",
    fontSize: 12
  },
  tabTextActive: {
    color: "#f8fafc"
  },
  sheetGrid: {
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "#0f172a",
    padding: 2
  },
  sheetRow: {
    flexDirection: "row"
  },
  sheetCell: {
    width: 24,
    height: 24,
    margin: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  sheetCellActive: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#7ea896"
  },
  sheetCellInactive: {
    backgroundColor: "#0a0a0a"
  },
  sheetCellText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#0a0a0a"
  },
  sheetCellTextActive: {
    color: "#0f2e21"
  }
});
