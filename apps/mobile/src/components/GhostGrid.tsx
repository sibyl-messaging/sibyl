import { StyleSheet, View } from "react-native";

interface GhostGridProps {
  bitmap: number[][];
  offsetX: number;
  offsetY: number;
}

export function GhostGrid({ bitmap, offsetX, offsetY }: GhostGridProps) {
  return (
    <View
      style={[
        styles.wrapper,
        {
          transform: [{ translateX: offsetX }, { translateY: offsetY }]
        }
      ]}
    >
      {bitmap.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={styles.row}>
          {row.map((value, colIndex) => (
            <View
              key={`cell-${rowIndex}-${colIndex}`}
              style={[
                styles.cell,
                value === 1 ? styles.signalPixel : styles.noisePixel
              ]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: "center",
    borderColor: "#111827",
    borderWidth: 2,
    backgroundColor: "#000"
  },
  row: {
    flexDirection: "row"
  },
  cell: {
    width: 18,
    height: 18
  },
  signalPixel: {
    backgroundColor: "#ffffff"
  },
  noisePixel: {
    backgroundColor: "#111111"
  }
});
