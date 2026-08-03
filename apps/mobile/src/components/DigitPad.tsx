import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface DigitPadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}

export function DigitPad({ onDigit, onBackspace, onClear }: DigitPadProps) {
  const rows = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["CLR", "0", "BK"]
  ];

  return (
    <View style={styles.wrapper}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row}>
          {row.map((item) => {
            const onPress = () => {
              if (item === "CLR") {
                onClear();
                return;
              }

              if (item === "BK") {
                onBackspace();
                return;
              }

              onDigit(item);
            };

            return (
              <TouchableOpacity
                key={item}
                style={styles.key}
                onPress={onPress}
                activeOpacity={0.8}
              >
                <Text style={styles.keyText}>{item}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 12,
    gap: 8
  },
  row: {
    flexDirection: "row",
    gap: 8
  },
  key: {
    flex: 1,
    height: 56,
    borderRadius: 10,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center"
  },
  keyText: {
    color: "#f9fafb",
    fontWeight: "700",
    fontSize: 18
  }
});
