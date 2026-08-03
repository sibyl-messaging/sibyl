import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface CalibrationScreenProps {
  initialPxPerMm: number | null;
  onCalibrated: (pxPerMm: number) => void;
}

const CARD_WIDTH_MM = 85.6;
const CARD_HEIGHT_MM = 53.98;

export function CalibrationScreen({
  initialPxPerMm,
  onCalibrated
}: CalibrationScreenProps) {
  const [cardWidthPx, setCardWidthPx] = useState(
    initialPxPerMm ? Math.round(initialPxPerMm * CARD_WIDTH_MM) : 320
  );

  const pxPerMm = cardWidthPx / CARD_WIDTH_MM;
  const cardHeightPx = Math.round(pxPerMm * CARD_HEIGHT_MM);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Credit Card Calibration</Text>
      <Text style={styles.body}>
        Place an ISO card on the screen and adjust until the box matches exactly.
      </Text>

      <View style={styles.calibrationFrame}>
        <View style={[styles.cardOutline, { width: cardWidthPx, height: cardHeightPx }]} />
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => setCardWidthPx((value) => Math.max(180, value - 2))}
        >
          <Text style={styles.controlButtonText}>-</Text>
        </TouchableOpacity>
        <Text style={styles.scaleText}>{pxPerMm.toFixed(3)} px/mm</Text>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => setCardWidthPx((value) => Math.min(500, value + 2))}
        >
          <Text style={styles.controlButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.confirmButton}
        onPress={() => onCalibrated(pxPerMm)}
      >
        <Text style={styles.confirmButtonText}>Lock Calibration</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#fafaf9"
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827"
  },
  body: {
    marginTop: 8,
    color: "#374151"
  },
  calibrationFrame: {
    marginTop: 24,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 260
  },
  cardOutline: {
    borderWidth: 2,
    borderColor: "#111827",
    borderStyle: "dashed"
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16
  },
  controlButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "#1f2937"
  },
  controlButtonText: {
    color: "#f9fafb",
    fontSize: 24,
    fontWeight: "700"
  },
  scaleText: {
    minWidth: 100,
    textAlign: "center",
    fontWeight: "700",
    color: "#111827"
  },
  confirmButton: {
    marginTop: 20,
    height: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827"
  },
  confirmButtonText: {
    color: "#f9fafb",
    fontWeight: "700"
  }
});
