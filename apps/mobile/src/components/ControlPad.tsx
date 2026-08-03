import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface ControlPadProps {
  onMove: (dx: number, dy: number) => void;
}

export function ControlPad({ onMove }: ControlPadProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.button} onPress={() => onMove(0, -1)}>
        <Text style={styles.label}>UP</Text>
      </TouchableOpacity>
      <View style={styles.middleRow}>
        <TouchableOpacity style={styles.button} onPress={() => onMove(-1, 0)}>
          <Text style={styles.label}>LEFT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => onMove(1, 0)}>
          <Text style={styles.label}>RIGHT</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.button} onPress={() => onMove(0, 1)}>
        <Text style={styles.label}>DOWN</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    gap: 8
  },
  middleRow: {
    flexDirection: "row",
    gap: 8
  },
  button: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  label: {
    color: "#f8fafc",
    fontWeight: "700"
  }
});
