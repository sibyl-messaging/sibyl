import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult
} from "expo-camera";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  stampHelperQrPayloadSchema,
  type StampBundleDescriptor,
  type StampHelperAttachmentClaim,
  type StampHelperAttachmentClaimStatus,
  type StampHelperSlot
} from "@sibyl/protocol";

import { TransportClient } from "../services/transportClient";

const PAPER = "#f4f0e6";
const INK = "#17201b";
const MUTED = "#5b625d";
const GREEN = "#1f6b4f";

export interface StampPreparationSetup {
  descriptor: StampBundleDescriptor;
  helperSlots: StampHelperSlot[];
}

interface PrepareStampsScreenProps {
  accessToken: string;
  conversationId: string;
  recipientUsername: string;
  transport: TransportClient;
  initialSetup?: StampPreparationSetup | null;
  onSetupCreated?: (setup: StampPreparationSetup) => void;
  onClose: () => void;
}

export function PrepareStampsScreen({
  accessToken,
  conversationId,
  recipientUsername,
  transport,
  initialSetup = null,
  onSetupCreated,
  onClose
}: PrepareStampsScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [shareCount, setShareCount] = useState(2);
  const [setup, setSetup] = useState<StampPreparationSetup | null>(initialSetup);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [claim, setClaim] = useState<StampHelperAttachmentClaim | null>(null);
  const [claimStatus, setClaimStatus] =
    useState<StampHelperAttachmentClaimStatus | null>(null);
  const [scanLocked, setScanLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundleState, setBundleState] = useState<StampBundleDescriptor["state"]>(
    initialSetup?.descriptor.state ?? "proposed"
  );

  useEffect(() => {
    if (initialSetup) {
      setSetup(initialSetup);
      setBundleState(initialSetup.descriptor.state);
    }
  }, [initialSetup]);

  const orderedSlots = useMemo(
    () => [...(setup?.helperSlots ?? [])].sort((a, b) => a.shareIndex - b.shareIndex),
    [setup]
  );
  const currentSlot = orderedSlots.find((slot) => !completed.has(slot.shareIndex));
  const localDone = Boolean(setup && !currentSlot && orderedSlots.length > 0);

  useEffect(() => {
    if (!claim || claimStatus?.state === "completed") return;
    let cancelled = false;
    const check = async () => {
      try {
        const status = await transport.getStampHelperClaim(accessToken, claim.claimId);
        if (cancelled) return;
        setClaimStatus(status);
        if (status.state === "completed") {
          setCompleted((previous) => new Set(previous).add(status.shareIndex));
          setClaim(null);
          setClaimStatus(null);
          setScanLocked(false);
          setError(null);
        } else if (status.state === "expired") {
          setClaim(null);
          setClaimStatus(null);
          setScanLocked(false);
          setError("That link expired. Scan this helper phone again.");
        }
      } catch {
        if (!cancelled) setError("We could not check the helper phone. Trying again…");
      }
    };
    void check();
    const timer = setInterval(() => void check(), 1_500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, claim, claimStatus?.state, transport]);

  useEffect(() => {
    if (!localDone || !setup || bundleState === "ready") return;
    let cancelled = false;
    const check = async () => {
      try {
        const descriptor = await transport.getStampBundle(
          accessToken,
          setup.descriptor.bundleId
        );
        if (!cancelled) setBundleState(descriptor.state);
      } catch {
        // A live WebSocket update or the next poll can recover this state.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, bundleState, localDone, setup, transport]);

  const createBundle = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await transport.createStampBundle(
        accessToken,
        conversationId,
        shareCount
      );
      setSetup(created);
      setBundleState(created.descriptor.state);
      onSetupCreated?.(created);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "We could not start paper stamps. Check that the other person is online."
      );
    } finally {
      setBusy(false);
    }
  };

  const scanHelper = async ({ data }: BarcodeScanningResult) => {
    if (!currentSlot || scanLocked || busy) return;
    setScanLocked(true);
    setBusy(true);
    setError(null);
    try {
      const payload = stampHelperQrPayloadSchema.parse(JSON.parse(data));
      const linkCode = createLinkCode();
      const nextClaim = await transport.attachStampHelper(accessToken, {
        bundleId: currentSlot.bundleId,
        pairId: currentSlot.pairId,
        registrationId: payload.registrationId,
        linkCode
      });
      setClaim(nextClaim);
      setClaimStatus({
        version: 2,
        claimId: nextClaim.claimId,
        bundleId: nextClaim.bundleId,
        pairId: nextClaim.pairId,
        shareIndex: nextClaim.shareIndex,
        role: nextClaim.role,
        state: nextClaim.state,
        expiresAtMs: nextClaim.expiresAtMs
      });
    } catch {
      setScanLocked(false);
      setError("That is not a valid Sibyl helper QR. Try scanning again.");
    } finally {
      setBusy(false);
    }
  };

  if (!setup) {
    return (
      <PageShell onClose={onClose}>
        <View style={styles.centered}>
          <Text style={styles.eyebrow}>Make matching stamps</Text>
          <Text style={styles.title}>How many phones each?</Text>
          <Text style={styles.detail}>You and {recipientUsername} link the same numbered phones.</Text>
          <View style={styles.stepper} accessibilityRole="adjustable">
            <TouchableOpacity
              accessibilityLabel="Use one fewer helper phone"
              disabled={shareCount <= 2}
              onPress={() => setShareCount((value) => Math.max(2, value - 1))}
              style={[styles.stepButton, shareCount <= 2 && styles.disabled]}
            >
              <Text style={styles.stepButtonText}>−</Text>
            </TouchableOpacity>
            <View style={styles.countBlock}>
              <Text style={styles.count}>{shareCount}</Text>
              <Text style={styles.countLabel}>phones each</Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Use one more helper phone"
              disabled={shareCount >= 10}
              onPress={() => setShareCount((value) => Math.min(10, value + 1))}
              style={[styles.stepButton, shareCount >= 10 && styles.disabled]}
            >
              <Text style={styles.stepButtonText}>+</Text>
            </TouchableOpacity>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton
            disabled={busy}
            label={busy ? "Starting…" : `Start with ${shareCount}`}
            onPress={() => void createBundle()}
          />
          <Text style={styles.note}>Two is the minimum. You can choose up to ten.</Text>
        </View>
      </PageShell>
    );
  }

  if (bundleState === "ready") {
    return (
      <PageShell onClose={onClose} hideBack>
        <View style={styles.centered}>
          <View style={styles.doneMark}><Text style={styles.doneMarkText}>✓</Text></View>
          <Text style={styles.eyebrow}>Both people finished</Text>
          <Text style={styles.title}>Stamps ready.</Text>
          <Text style={styles.detail}>You can now send one paper message.</Text>
          <PrimaryButton label="Return to messages" onPress={onClose} />
        </View>
      </PageShell>
    );
  }

  if (localDone) {
    return (
      <PageShell onClose={onClose}>
        <View style={styles.centered}>
          <ActivityIndicator color={GREEN} size="large" />
          <Text style={styles.eyebrow}>Your side is done</Text>
          <Text style={styles.title}>Waiting for {recipientUsername}.</Text>
          <Text style={styles.detail}>Keep this app open. We will tell you when both sides finish.</Text>
        </View>
      </PageShell>
    );
  }

  const progress = `Helper ${completed.size + 1} of ${orderedSlots.length}`;

  if (claim) {
    const approved = claimStatus?.state === "approved";
    return (
      <PageShell onClose={onClose}>
        <View style={styles.centered}>
          <Progress label={progress} complete={completed.size} total={orderedSlots.length} />
          <Text style={styles.eyebrow}>{approved ? `Phone ${claim.shareIndex + 1} linked` : "Say these digits"}</Text>
          <Text style={styles.title}>
            {approved ? "Keep the borrowed phone open." : "Show this code to the borrowed phone."}
          </Text>
          {approved ? (
            <>
              <ActivityIndicator color={GREEN} size="large" style={styles.waitSpinner} />
              <Text style={styles.detail}>
                Its numbers appear after {recipientUsername} links Phone {claim.shareIndex + 1}.
              </Text>
            </>
          ) : (
            <>
              <View style={styles.codeBlock} accessibilityLabel={`Link code ${claim.linkCode}`}>
                <Text style={styles.code}>{claim.linkCode.slice(0, 3)} {claim.linkCode.slice(3)}</Text>
              </View>
              <Text style={styles.detail}>The helper types this code. A photograph of its QR is not enough.</Text>
            </>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </PageShell>
    );
  }

  if (!permission) {
    return (
      <PageShell onClose={onClose}>
        <View style={styles.centered}><ActivityIndicator color={GREEN} size="large" /></View>
      </PageShell>
    );
  }

  if (!permission.granted) {
    return (
      <PageShell onClose={onClose}>
        <View style={styles.centered}>
          <Progress label={progress} complete={completed.size} total={orderedSlots.length} />
          <Text style={styles.eyebrow}>Matching stamp {completed.size + 1}</Text>
          <Text style={styles.title}>Link your Phone {completed.size + 1}.</Text>
          <Text style={styles.detail}>{recipientUsername} must link Phone {completed.size + 1} too.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton label="Allow camera" onPress={() => void requestPermission()} />
        </View>
      </PageShell>
    );
  }

  return (
    <SafeAreaView style={styles.cameraPage}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={scanLocked ? undefined : (result) => void scanHelper(result)}
      />
      <View style={styles.cameraShade}>
        <View style={styles.cameraTop}>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.backOnCamera}>
            <Text style={styles.backOnCameraText}>Back</Text>
          </TouchableOpacity>
          <Progress label={progress} complete={completed.size} total={orderedSlots.length} inverted />
        </View>
        <View style={styles.scanFrame} accessibilityLabel="Place the helper QR inside this square" />
        <View style={styles.cameraInstruction}>
          <Text style={styles.cameraTitle}>Link your Phone {completed.size + 1}.</Text>
          <Text style={styles.cameraDetail}>{recipientUsername} must link Phone {completed.size + 1} too.</Text>
          {busy ? <ActivityIndicator color={PAPER} /> : null}
          {error ? <Text style={styles.cameraError}>{error}</Text> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

function PageShell({
  children,
  onClose,
  hideBack = false
}: {
  children: React.ReactNode;
  onClose: () => void;
  hideBack?: boolean;
}) {
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.topBar}>
        {hideBack ? <View style={styles.backPlaceholder} /> : (
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.wordmark}>SIBYL</Text>
        <View style={styles.backPlaceholder} />
      </View>
      {children}
    </SafeAreaView>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled && styles.disabled]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function Progress({
  label,
  complete,
  total,
  inverted = false
}: {
  label: string;
  complete: number;
  total: number;
  inverted?: boolean;
}) {
  return (
    <View style={styles.progressWrap}>
      <Text style={[styles.progressLabel, inverted && styles.invertedText]}>{label}</Text>
      <View style={[styles.progressTrack, inverted && styles.progressTrackInverted]}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={[
              styles.progressSegment,
              index < complete && styles.progressSegmentDone,
              inverted && index >= complete && styles.progressSegmentInverted
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function createLinkCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  let value = limit;
  while (value >= limit) {
    const bytes = randomBytes(4);
    value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
    bytes.fill(0);
  }
  return String(value % 1_000_000).padStart(6, "0");
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: PAPER },
  topBar: {
    minHeight: 64,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  backButton: { minWidth: 56, minHeight: 48, justifyContent: "center" },
  backText: { color: INK, fontSize: 16, fontWeight: "700" },
  backPlaceholder: { width: 56 },
  wordmark: { color: INK, fontSize: 13, fontWeight: "800", letterSpacing: 2 },
  centered: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: "center",
    justifyContent: "center"
  },
  eyebrow: {
    marginTop: 24,
    marginBottom: 12,
    color: MUTED,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    textAlign: "center"
  },
  title: {
    color: INK,
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: -1.8,
    lineHeight: 42,
    textAlign: "center"
  },
  detail: {
    maxWidth: 360,
    marginTop: 16,
    color: MUTED,
    fontSize: 17,
    lineHeight: 24,
    textAlign: "center"
  },
  note: { marginTop: 16, color: MUTED, fontSize: 13, textAlign: "center" },
  error: { marginTop: 16, color: "#8a2f27", fontSize: 15, lineHeight: 21, textAlign: "center" },
  stepper: { marginTop: 40, flexDirection: "row", alignItems: "center", gap: 20 },
  stepButton: {
    width: 56,
    height: 56,
    borderWidth: 2,
    borderColor: INK,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fffdf7"
  },
  stepButtonText: { color: INK, fontSize: 30, fontWeight: "600", lineHeight: 32 },
  countBlock: { minWidth: 112, alignItems: "center" },
  count: { color: INK, fontSize: 72, fontWeight: "800", lineHeight: 76 },
  countLabel: { color: MUTED, fontSize: 14, fontWeight: "700" },
  primaryButton: {
    width: "100%",
    minHeight: 58,
    marginTop: 32,
    borderWidth: 2,
    borderColor: INK,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: { color: "#fffdf7", fontSize: 17, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  progressWrap: { width: "100%", maxWidth: 360, marginBottom: 32 },
  progressLabel: { marginBottom: 8, color: MUTED, fontSize: 13, fontWeight: "800", textAlign: "center" },
  progressTrack: { flexDirection: "row", gap: 4 },
  progressTrackInverted: { borderColor: PAPER },
  progressSegment: { flex: 1, height: 5, backgroundColor: "#cbc9c1" },
  progressSegmentDone: { backgroundColor: GREEN },
  progressSegmentInverted: { backgroundColor: "#7b817d" },
  invertedText: { color: PAPER },
  codeBlock: {
    width: "100%",
    marginTop: 32,
    paddingVertical: 24,
    borderWidth: 2,
    borderColor: INK,
    backgroundColor: "#fffdf7"
  },
  code: {
    color: INK,
    fontSize: 46,
    fontWeight: "800",
    letterSpacing: 3,
    textAlign: "center",
    fontVariant: ["tabular-nums"]
  },
  waitSpinner: { marginTop: 32 },
  doneMark: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: INK,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center"
  },
  doneMarkText: { color: "#fffdf7", fontSize: 44, fontWeight: "900" },
  cameraPage: { flex: 1, backgroundColor: INK },
  cameraShade: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: "space-between",
    backgroundColor: "rgba(23,32,27,0.34)"
  },
  cameraTop: { gap: 8 },
  backOnCamera: { alignSelf: "flex-start", minWidth: 56, minHeight: 48, justifyContent: "center" },
  backOnCameraText: { color: PAPER, fontSize: 16, fontWeight: "800" },
  scanFrame: {
    alignSelf: "center",
    width: 260,
    height: 260,
    borderWidth: 4,
    borderColor: PAPER,
    backgroundColor: "transparent"
  },
  cameraInstruction: { minHeight: 160, alignItems: "center", justifyContent: "center" },
  cameraTitle: { color: PAPER, fontSize: 30, fontWeight: "800", letterSpacing: -1, textAlign: "center" },
  cameraDetail: { marginTop: 8, color: PAPER, fontSize: 16, textAlign: "center" },
  cameraError: { marginTop: 12, color: "#ffd8d2", fontSize: 14, textAlign: "center" }
});
