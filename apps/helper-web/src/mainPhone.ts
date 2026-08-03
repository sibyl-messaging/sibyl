import { randomBytes } from "@noble/hashes/utils.js";
import {
  formatPublicStampLabel,
  generateX25519KeyPair,
  signStampCiphertextMessage,
  signedStampCiphertextMessageSchema,
  stampBundleSetupSchema,
  stampHelperAttachmentClaimSchema,
  stampHelperAttachmentClaimStatusSchema,
  stampHelperQrPayloadSchema,
  type StampBundleSetup,
  type StampBundleDescriptor,
  type StampHelperAttachmentClaim,
  type StampHelperAttachmentClaimStatus,
  type SignedStampCiphertextMessage
} from "@sibyl/protocol";
import QrScanner from "qr-scanner";
import nacl from "tweetnacl";
import { z } from "zod";

const POLL_MS = 1_500;
const STATE_KEY = "sibyl.paper-test.state.v1";
const CREDENTIALS_PREFIX = "sibyl.paper-test.credentials.";

type TestRole = "start" | "join";

interface BrowserCredentials {
  username: string;
  deviceId: string;
  signingPublicKey: string;
  signingSecretKey: string;
  x25519PublicKey: string;
  x25519PrivateKey: string;
}

interface TestState {
  username: string;
  friendUsername: string;
  role: TestRole;
  shareCount: number;
  conversationId?: string;
  finishedMessage?: {
    direction: "sent" | "received";
    stampLabel: string;
  };
}

const authChallengeSchema = z.object({
  challengeId: z.string(),
  nonce: z.string()
});

const authVerifySchema = z.object({
  accessToken: z.string(),
  auth: z.object({
    userId: z.string(),
    username: z.string(),
    deviceId: z.string()
  })
});

const conversationSchema = z.object({
  conversationId: z.string(),
  status: z.enum(["pending", "active"])
});

const conversationStatusSchema = conversationSchema.extend({
  peerUsername: z.string(),
  startedByCurrentUser: z.boolean()
});

const invitesSchema = z.object({
  invites: z.array(
    z.object({
      conversationId: z.string(),
      invitedByUsername: z.string()
    })
  )
});

const activeSetupSchema = z.object({
  setup: stampBundleSetupSchema.nullable()
});

const createdSetupSchema = stampBundleSetupSchema.omit({
  completedShareIndexes: true
});

const pendingStampMessagesSchema = z.object({
  messages: z.array(signedStampCiphertextMessageSchema)
});

const sentStampMessageSchema = z.object({
  messageId: z.string(),
  bundleId: z.string(),
  status: z.literal("accepted")
});

export function startMainPhone(app: HTMLDivElement, relayUrl: string): void {
  const flow = new MainPhoneFlow(app, relayUrl);
  void flow.start();
}

class MainPhoneFlow {
  private readonly relay: BrowserRelayClient;
  private state: TestState | null = null;
  private accessToken: string | null = null;
  private scanner: QrScanner | null = null;
  private stopped = false;

  constructor(
    private readonly app: HTMLDivElement,
    relayUrl: string
  ) {
    this.relay = new BrowserRelayClient(relayUrl);
    window.addEventListener("pagehide", () => this.destroy(), { once: true });
  }

  async start(): Promise<void> {
    const saved = readJson<TestState>(STATE_KEY);
    if (saved?.username && saved.friendUsername && saved.role) {
      this.state = saved;
      this.renderContinue(saved);
      return;
    }
    this.renderRoleChoice();
  }

  private renderRoleChoice(): void {
    this.app.innerHTML = shell(`
      <section class="step role-step" aria-labelledby="main-title">
        <p class="eyebrow">Your main phone</p>
        <h1 id="main-title">Make matching stamps together.</h1>
        <p class="detail">One person starts. The other joins.</p>
        <button class="primary-button" id="start-test" type="button">I’ll start</button>
        <button class="secondary-button" id="join-test" type="button">I’ll join</button>
        <a class="text-link" href="./">Use a different phone</a>
      </section>
    `);
    this.onClick("start-test", () => this.renderIdentity("start"));
    this.onClick("join-test", () => this.renderIdentity("join"));
  }

  private renderIdentity(role: TestRole): void {
    this.app.innerHTML = shell(`
      <section class="step form-step" aria-labelledby="identity-title">
        <p class="eyebrow">${role === "start" ? "Start a test" : "Join a test"}</p>
        <h1 id="identity-title">Name both people.</h1>
        <form id="identity-form" class="simple-form">
          <label for="your-name">Your test name</label>
          <input id="your-name" name="your-name" autocomplete="username" autocapitalize="none" minlength="3" maxlength="24" placeholder="alice7" required />
          <label for="friend-name">Friend’s test name</label>
          <input id="friend-name" name="friend-name" autocapitalize="none" minlength="3" maxlength="24" placeholder="bob7" required />
          ${role === "start" ? helperCountMarkup() : ""}
          <p class="form-error" id="identity-error" aria-live="polite"></p>
          <button class="primary-button" type="submit">${role === "start" ? "Start test" : "Find friend"}</button>
        </form>
        <button class="text-button" id="identity-back" type="button">Back</button>
      </section>
    `);
    let shareCount = 2;
    if (role === "start") {
      const count = this.app.querySelector<HTMLElement>("#helper-count");
      this.onClick("fewer-helpers", () => {
        shareCount = Math.max(2, shareCount - 1);
        if (count) count.textContent = String(shareCount);
      });
      this.onClick("more-helpers", () => {
        shareCount = Math.min(10, shareCount + 1);
        if (count) count.textContent = String(shareCount);
      });
    }
    this.onClick("identity-back", () => this.renderRoleChoice());
    this.app.querySelector<HTMLFormElement>("#identity-form")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        const own = normalizeUsername(
          this.valueOf("your-name")
        );
        const friend = normalizeUsername(
          this.valueOf("friend-name")
        );
        const error = this.app.querySelector<HTMLElement>("#identity-error");
        if (!isUsername(own) || !isUsername(friend)) {
          if (error) error.textContent = "Use 3–24 letters, numbers, or underscores.";
          return;
        }
        if (own === friend) {
          if (error) error.textContent = "Use two different names.";
          return;
        }
        this.state = {
          username: own,
          friendUsername: friend,
          role,
          shareCount
        };
        saveJson(STATE_KEY, this.state);
        void this.connect();
      }
    );
  }

  private renderContinue(state: TestState): void {
    this.app.innerHTML = shell(`
      <section class="step" aria-labelledby="continue-title">
        <p class="eyebrow">Unfinished test</p>
        <h1 id="continue-title">Continue as ${escapeHtml(state.username)}?</h1>
        <p class="detail">Testing with ${escapeHtml(state.friendUsername)}.</p>
        <button class="primary-button" id="continue-test" type="button">Continue test</button>
        <button class="secondary-button" id="new-test" type="button">Start a new test</button>
      </section>
    `);
    this.onClick("continue-test", () => void this.connect());
    this.onClick("new-test", () => {
      localStorage.removeItem(STATE_KEY);
      this.state = null;
      this.renderRoleChoice();
    });
  }

  private async connect(): Promise<void> {
    if (!this.state) return;
    this.renderWaiting("Opening your test…", "Keep this page open.");
    try {
      this.accessToken = await this.authenticate(this.state.username);
      if (this.state.conversationId) {
        await this.waitForConversation(this.state.conversationId);
        return;
      }
      if (this.state.role === "start") {
        await this.startConversation();
      } else {
        await this.waitForInvite();
      }
    } catch (error) {
      this.renderError(readError(error), () => void this.connect());
    }
  }

  private async authenticate(username: string): Promise<string> {
    let credentials = readJson<BrowserCredentials>(
      `${CREDENTIALS_PREFIX}${username}`
    );
    if (!credentials) {
      credentials = createCredentials(username);
      const response = await this.relay.registerUser(credentials);
      if (response.status === 409) {
        throw new Error(
          `“${username}” is already used. Go back and choose a new test name.`
        );
      }
      if (!response.ok) throw await responseError(response);
      saveJson(`${CREDENTIALS_PREFIX}${username}`, credentials);
    }
    const challenge = authChallengeSchema.parse(
      await this.relay.postJson("/v1/auth/challenge", {
        username,
        deviceId: credentials.deviceId
      })
    );
    const signature = nacl.sign.detached(
      base64ToBytes(challenge.nonce),
      base64ToBytes(credentials.signingSecretKey)
    );
    const verified = authVerifySchema.parse(
      await this.relay.postJson("/v1/auth/verify", {
        challengeId: challenge.challengeId,
        signature: bytesToBase64(signature)
      })
    );
    return verified.accessToken;
  }

  private async startConversation(): Promise<void> {
    if (!this.state || !this.accessToken) return;
    this.renderWaiting(
      `Waiting for ${escapeHtml(this.state.friendUsername)}…`,
      "Ask them to choose “I’ll join.”"
    );
    const lookup = await this.relay.get(
      `/v1/users/lookup?username=${encodeURIComponent(this.state.friendUsername)}`,
      this.accessToken
    );
    if (lookup.status === 404) {
      window.setTimeout(() => void this.startConversation(), POLL_MS);
      return;
    }
    if (!lookup.ok) throw await responseError(lookup);
    const created = conversationSchema.parse(
      await this.relay.postJson(
        "/v1/conversations",
        { recipientUsername: this.state.friendUsername },
        this.accessToken
      )
    );
    this.state.conversationId = created.conversationId;
    saveJson(STATE_KEY, this.state);
    await this.waitForConversation(created.conversationId);
  }

  private async waitForInvite(): Promise<void> {
    if (!this.state || !this.accessToken) return;
    this.renderWaiting(
      `Waiting for ${escapeHtml(this.state.friendUsername)}…`,
      "They must tap “Start test.”"
    );
    const invites = invitesSchema.parse(
      await this.relay.getJson("/v1/conversations/invites", this.accessToken)
    );
    const invite = invites.invites.find(
      (item) => item.invitedByUsername === this.state?.friendUsername
    );
    if (!invite) {
      window.setTimeout(() => void this.waitForInvite(), POLL_MS);
      return;
    }
    await this.relay.postJson(
      `/v1/conversations/${encodeURIComponent(invite.conversationId)}/accept`,
      {},
      this.accessToken
    );
    this.state.conversationId = invite.conversationId;
    saveJson(STATE_KEY, this.state);
    await this.waitForConversation(invite.conversationId);
  }

  private async waitForConversation(conversationId: string): Promise<void> {
    if (!this.state || !this.accessToken) return;
    const status = conversationStatusSchema.parse(
      await this.relay.getJson(
        `/v1/conversations/${encodeURIComponent(conversationId)}`,
        this.accessToken
      )
    );
    if (status.status !== "active") {
      this.renderWaiting(
        `Waiting for ${escapeHtml(this.state.friendUsername)}…`,
        "Both people must keep this page open."
      );
      window.setTimeout(
        () => void this.waitForConversation(conversationId),
        POLL_MS
      );
      return;
    }
    await this.loadOrCreateSetup();
  }

  private async loadOrCreateSetup(): Promise<void> {
    if (!this.state?.conversationId || !this.accessToken) return;
    if (this.state.finishedMessage) {
      this.renderMessageFinished(
        this.state.finishedMessage.direction,
        this.state.finishedMessage.stampLabel
      );
      return;
    }
    if (this.state.role === "join") {
      const pendingMessage = await this.findPendingMessage();
      if (pendingMessage) {
        this.renderReceivedMessage(pendingMessage);
        return;
      }
    }
    const active = activeSetupSchema.parse(
      await this.relay.getJson(
        `/v2/stamp-bundles/active?conversationId=${encodeURIComponent(this.state.conversationId)}`,
        this.accessToken
      )
    );
    if (active.setup) {
      await this.showSetup(active.setup);
      return;
    }
    if (this.state.role === "join") {
      this.renderWaiting("Your friend is starting…", "Keep this page open.");
      window.setTimeout(() => void this.loadOrCreateSetup(), POLL_MS);
      return;
    }
    const response = createdSetupSchema.parse(
      await this.relay.postJson(
        "/v2/stamp-bundles",
        {
          conversationId: this.state.conversationId,
          shareCount: this.state.shareCount
        },
        this.accessToken
      )
    );
    const created = stampBundleSetupSchema.parse({
      ...response,
      completedShareIndexes: []
    });
    await this.showSetup(created);
  }

  private async showSetup(setup: StampBundleSetup): Promise<void> {
    if (setup.descriptor.state === "ready") {
      if (this.state?.role === "start") {
        this.renderSendMessage(setup.descriptor);
      } else {
        await this.waitForMessage(setup.descriptor);
      }
      return;
    }
    const complete = new Set(setup.completedShareIndexes);
    const slot = [...setup.helperSlots]
      .sort((a, b) => a.shareIndex - b.shareIndex)
      .find((item) => !complete.has(item.shareIndex));
    if (!slot) {
      this.renderWaiting("Your stamps are copied.", "Waiting for your friend…");
      window.setTimeout(() => void this.loadOrCreateSetup(), POLL_MS);
      return;
    }
    this.renderScanner(setup, slot.shareIndex);
  }

  private async findPendingMessage(
    bundleId?: string
  ): Promise<SignedStampCiphertextMessage | null> {
    if (!this.state?.conversationId || !this.accessToken) return null;
    const pending = pendingStampMessagesSchema.parse(
      await this.relay.getJson("/v2/stamp-messages", this.accessToken)
    );
    return pending.messages.find(
      (message) =>
        message.conversationId === this.state?.conversationId &&
        (!bundleId || message.bundleId === bundleId)
    ) ?? null;
  }

  private async waitForMessage(descriptor: StampBundleDescriptor): Promise<void> {
    const pendingMessage = await this.findPendingMessage(descriptor.bundleId);
    if (pendingMessage) {
      this.renderReceivedMessage(pendingMessage);
      return;
    }
    this.renderWaiting(
      `Waiting for ${escapeHtml(this.state?.friendUsername ?? "your friend")} to send…`,
      `Keep this open. Have ${formatPublicStampLabel(descriptor.bundleId)} on paper.`
    );
    window.setTimeout(() => void this.waitForMessage(descriptor), POLL_MS);
  }

  private renderSendMessage(descriptor: StampBundleDescriptor): void {
    const stampLabel = formatPublicStampLabel(descriptor.bundleId);
    this.app.innerHTML = shell(`
      <section class="step message-step" aria-labelledby="send-title">
        <p class="eyebrow">${stampLabel} · Ready</p>
        <h1 id="send-title">Enter the encoded letters.</h1>
        <p class="detail">Write and encode the real message on paper first.</p>
        <form id="cipher-form" class="cipher-form">
          <label for="ciphertext">Encoded letters only</label>
          <textarea
            id="ciphertext"
            name="ciphertext"
            rows="3"
            maxlength="26"
            autocomplete="off"
            autocapitalize="characters"
            autocorrect="off"
            spellcheck="false"
            aria-describedby="cipher-count cipher-error"
          ></textarea>
          <div class="cipher-meta">
            <span id="cipher-count">0 of 26</span>
            <span class="form-error" id="cipher-error" aria-live="polite"></span>
          </div>
          <button class="primary-button" id="send-message" type="submit" disabled>Send encoded message</button>
        </form>
        <p class="privacy-note"><strong>Never type the original message here.</strong></p>
      </section>
    `);
    const form = this.app.querySelector<HTMLFormElement>("#cipher-form");
    const input = this.app.querySelector<HTMLTextAreaElement>("#ciphertext");
    const count = this.app.querySelector<HTMLElement>("#cipher-count");
    const button = this.app.querySelector<HTMLButtonElement>("#send-message");
    input?.addEventListener("input", () => {
      if (!input) return;
      input.value = normalizeCiphertext(input.value);
      if (count) count.textContent = `${input.value.length} of 26`;
      if (button) button.disabled = input.value.length === 0;
    });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (input) void this.sendMessage(descriptor, input.value);
    });
  }

  private async sendMessage(
    descriptor: StampBundleDescriptor,
    rawCiphertext: string
  ): Promise<void> {
    if (!this.state || !this.accessToken) return;
    const ciphertext = normalizeCiphertext(rawCiphertext);
    const button = this.app.querySelector<HTMLButtonElement>("#send-message");
    const error = this.app.querySelector<HTMLElement>("#cipher-error");
    if (!ciphertext) {
      if (error) error.textContent = "Enter at least one encoded letter.";
      return;
    }
    const credentials = readJson<BrowserCredentials>(
      `${CREDENTIALS_PREFIX}${this.state.username}`
    );
    if (!credentials) {
      this.renderError("This phone’s signing key is missing.", () => void this.connect());
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = "Sending…";
    }
    if (error) error.textContent = "";
    try {
      const signingKey = base64ToBytes(credentials.signingSecretKey);
      const message = signStampCiphertextMessage(
        {
          version: 2,
          messageId: `webmsg_${crypto.randomUUID().replace(/-/g, "")}`,
          conversationId: this.state.conversationId!,
          bundleId: descriptor.bundleId,
          senderUserId: descriptor.initiatorUserId,
          recipientUserId: descriptor.recipientUserId,
          ciphertext,
          createdAtMs: Date.now(),
          senderSigningKeyId: credentials.deviceId
        },
        signingKey
      );
      signingKey.fill(0);
      sentStampMessageSchema.parse(
        await this.relay.postJson(
          "/v2/stamp-messages",
          message,
          this.accessToken
        )
      );
      this.finishMessage("sent", formatPublicStampLabel(descriptor.bundleId));
    } catch (sendError) {
      if (button) {
        button.disabled = false;
        button.textContent = "Send encoded message";
      }
      if (error) error.textContent = readError(sendError);
    }
  }

  private renderReceivedMessage(message: SignedStampCiphertextMessage): void {
    const stampLabel = formatPublicStampLabel(message.bundleId);
    this.app.innerHTML = shell(`
      <section class="step message-step" aria-labelledby="receive-title">
        <p class="eyebrow">${stampLabel} · New message</p>
        <h1 id="receive-title">Copy these encoded letters.</h1>
        <div class="encoded-strip" aria-label="Encoded message">${formatCiphertext(message.ciphertext)}</div>
        <p class="detail">Decode them on paper with ${stampLabel}.</p>
        <button class="primary-button" id="decoded-message" type="button">I decoded it and crossed it out</button>
        <p class="privacy-note"><strong>Never type the decoded message here.</strong></p>
      </section>
    `);
    this.onClick("decoded-message", () => void this.acknowledgeMessage(message));
  }

  private async acknowledgeMessage(
    message: SignedStampCiphertextMessage
  ): Promise<void> {
    if (!this.accessToken) return;
    const button = this.app.querySelector<HTMLButtonElement>("#decoded-message");
    if (button) {
      button.disabled = true;
      button.textContent = "Finishing…";
    }
    try {
      await this.relay.postJson(
        "/v2/stamp-messages/ack",
        { messageId: message.messageId },
        this.accessToken
      );
      this.finishMessage("received", formatPublicStampLabel(message.bundleId));
    } catch (error) {
      this.renderError(readError(error), () => this.renderReceivedMessage(message));
    }
  }

  private finishMessage(
    direction: "sent" | "received",
    stampLabel: string
  ): void {
    if (!this.state) return;
    this.state.finishedMessage = { direction, stampLabel };
    saveJson(STATE_KEY, this.state);
    this.renderMessageFinished(direction, stampLabel);
  }

  private renderMessageFinished(
    direction: "sent" | "received",
    stampLabel: string
  ): void {
    this.app.innerHTML = shell(`
      <section class="step status-step" aria-labelledby="done-title">
        <div class="done-mark" aria-hidden="true">✓</div>
        <p class="eyebrow">${direction === "sent" ? "Message sent" : "Message decoded"}</p>
        <h1 id="done-title">Cross out ${stampLabel}.</h1>
        <p class="detail">That paper stamp is used. Never use its numbers again.</p>
        <button class="secondary-button" id="finish-test" type="button">Finish test</button>
      </section>
    `);
    this.onClick("finish-test", () => {
      localStorage.removeItem(STATE_KEY);
      window.location.assign("./");
    });
  }

  private renderScanner(setup: StampBundleSetup, shareIndex: number): void {
    this.destroyScanner();
    const friendName = escapeHtml(this.state?.friendUsername ?? "Your friend");
    this.app.innerHTML = shell(`
      <section class="scan-step" aria-labelledby="scan-title">
        ${progressMarkup(shareIndex, setup.helperSlots.length)}
        <p class="eyebrow">Matching stamp ${shareIndex + 1}</p>
        <h1 id="scan-title">Link your Phone ${shareIndex + 1}.</h1>
        <div class="camera-frame"><video id="camera" playsinline muted></video></div>
        <p class="detail" id="camera-note">${friendName} must link Phone ${shareIndex + 1} too.</p>
        <button class="text-button" id="camera-retry" type="button" hidden>Try camera again</button>
      </section>
    `);
    const video = this.app.querySelector<HTMLVideoElement>("#camera");
    if (!video) return;
    const slot = setup.helperSlots.find((item) => item.shareIndex === shareIndex);
    if (!slot) return;
    this.scanner = new QrScanner(
      video,
      (result) => void this.onHelperScan(result.data, setup, slot.pairId),
      {
        preferredCamera: "environment",
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true
      }
    );
    this.scanner.start().catch(() => {
      const note = this.app.querySelector<HTMLElement>("#camera-note");
      const retry = this.app.querySelector<HTMLButtonElement>("#camera-retry");
      if (note) note.textContent = "Camera access was blocked. Allow it in browser settings.";
      if (retry) retry.hidden = false;
    });
    this.onClick("camera-retry", () => void this.scanner?.start());
  }

  private async onHelperScan(
    rawData: string,
    setup: StampBundleSetup,
    pairId: string
  ): Promise<void> {
    if (!this.accessToken) return;
    try {
      const payload = stampHelperQrPayloadSchema.parse(JSON.parse(rawData));
      this.destroyScanner();
      const linkCode = createLinkCode();
      const claim = stampHelperAttachmentClaimSchema.parse(
        await this.relay.postJson(
          "/v2/stamp-helpers/attach",
          {
            bundleId: setup.descriptor.bundleId,
            pairId,
            registrationId: payload.registrationId,
            linkCode
          },
          this.accessToken
        )
      );
      this.renderClaim(claim, "pending", setup.helperSlots.length);
      await this.pollClaim(claim, setup.helperSlots.length);
    } catch (error) {
      this.renderError(
        `That QR could not be linked. ${readError(error)}`,
        () => void this.loadOrCreateSetup()
      );
    }
  }

  private async pollClaim(
    claim: StampHelperAttachmentClaim,
    total: number
  ): Promise<void> {
    if (!this.accessToken || this.stopped) return;
    const status = stampHelperAttachmentClaimStatusSchema.parse(
      await this.relay.getJson(
        `/v2/stamp-helper-claims/${encodeURIComponent(claim.claimId)}`,
        this.accessToken
      )
    );
    this.renderClaim(claim, status.state, total);
    if (status.state === "completed") {
      await this.loadOrCreateSetup();
      return;
    }
    if (status.state === "expired") {
      this.renderError("That helper link expired.", () => void this.loadOrCreateSetup());
      return;
    }
    window.setTimeout(() => void this.pollClaim(claim, total), POLL_MS);
  }

  private renderClaim(
    claim: StampHelperAttachmentClaim,
    state: StampHelperAttachmentClaimStatus["state"],
    total: number
  ): void {
    const approved = state === "approved" || state === "completed";
    const friendName = escapeHtml(this.state?.friendUsername ?? "the other person");
    this.app.innerHTML = shell(`
      <section class="step" aria-labelledby="claim-title">
        ${progressMarkup(claim.shareIndex, total)}
        <p class="eyebrow">${approved ? `Phone ${claim.shareIndex + 1} linked` : "Say these digits"}</p>
        <h1 id="claim-title">${approved ? "Keep the borrowed phone open." : "Show this code to the borrowed phone."}</h1>
        ${approved
          ? `<div class="pulse-mark" aria-hidden="true"><span></span></div><p class="detail">Its numbers appear after ${friendName} links Phone ${claim.shareIndex + 1}.</p>`
          : `<div class="link-code" aria-label="Link code ${claim.linkCode}">${claim.linkCode.slice(0, 3)} ${claim.linkCode.slice(3)}</div><p class="detail">A photograph of its QR is not enough.</p>`}
      </section>
    `);
  }

  private renderWaiting(title: string, detail: string): void {
    this.app.innerHTML = shell(`
      <section class="step status-step" aria-labelledby="wait-title">
        <div class="pulse-mark" aria-hidden="true"><span></span></div>
        <p class="eyebrow">Making paper stamps</p>
        <h1 id="wait-title">${title}</h1>
        <p class="detail">${detail}</p>
      </section>
    `);
  }

  private renderError(message: string, retry: () => void): void {
    this.app.innerHTML = shell(`
      <section class="step status-step" aria-labelledby="error-title">
        <p class="eyebrow error-eyebrow">Couldn’t continue</p>
        <h1 id="error-title">Try that again.</h1>
        <p class="detail">${escapeHtml(message)}</p>
        <button class="primary-button" id="retry-action" type="button">Try again</button>
        <button class="text-button" id="reset-action" type="button">Start over</button>
      </section>
    `);
    this.onClick("retry-action", retry);
    this.onClick("reset-action", () => {
      localStorage.removeItem(STATE_KEY);
      this.state = null;
      this.renderRoleChoice();
    });
  }

  private valueOf(id: string): string {
    return this.app.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "";
  }

  private onClick(id: string, action: () => void): void {
    this.app.querySelector<HTMLElement>(`#${id}`)?.addEventListener("click", action);
  }

  private destroyScanner(): void {
    this.scanner?.stop();
    this.scanner?.destroy();
    this.scanner = null;
  }

  private destroy(): void {
    this.stopped = true;
    this.destroyScanner();
  }
}

class BrowserRelayClient {
  constructor(private readonly baseUrl: string) {}

  registerUser(credentials: BrowserCredentials): Promise<Response> {
    return fetch(`${this.baseUrl}/v1/users/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: credentials.username,
        deviceId: credentials.deviceId,
        signingPublicKey: credentials.signingPublicKey,
        x25519PublicKey: credentials.x25519PublicKey
      })
    });
  }

  get(path: string, token?: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined
    });
  }

  async getJson(path: string, token?: string): Promise<unknown> {
    const response = await this.get(path, token);
    if (!response.ok) throw await responseError(response);
    return response.json();
  }

  async postJson(path: string, body: unknown, token?: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw await responseError(response);
    return response.json();
  }
}

function helperCountMarkup(): string {
  return `
    <fieldset class="helper-choice">
      <legend>Helper phones per person</legend>
      <button type="button" id="fewer-helpers" aria-label="Use one fewer helper">−</button>
      <strong id="helper-count">2</strong>
      <button type="button" id="more-helpers" aria-label="Use one more helper">+</button>
    </fieldset>
  `;
}

function progressMarkup(shareIndex: number, total: number): string {
  return `
    <div class="setup-progress" aria-label="Borrowed phone ${shareIndex + 1} of ${total}">
      <span>Phone ${shareIndex + 1} of ${total}</span>
      <div>${Array.from({ length: total }, (_, index) =>
        `<i class="${index < shareIndex ? "complete" : ""}"></i>`
      ).join("")}</div>
    </div>
  `;
}

function shell(content: string): string {
  return `
    <main class="shell">
      <header class="wordmark"><span>S</span> Sibyl</header>
      ${content}
      <footer>Main phones never receive the paper numbers.</footer>
    </main>
  `;
}

function createCredentials(username: string): BrowserCredentials {
  const signing = nacl.sign.keyPair();
  const x25519 = generateX25519KeyPair();
  return {
    username,
    deviceId: `web_${crypto.randomUUID().replace(/-/g, "")}`,
    signingPublicKey: bytesToBase64(signing.publicKey),
    signingSecretKey: bytesToBase64(signing.secretKey),
    x25519PublicKey: bytesToBase64(x25519.publicKey),
    x25519PrivateKey: bytesToBase64(x25519.privateKey)
  };
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

async function responseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error || `Request failed (${response.status})`);
  } catch {
    return new Error(`Request failed (${response.status})`);
  }
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function isUsername(value: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(value);
}

function normalizeCiphertext(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 26);
}

function formatCiphertext(value: string): string {
  return value.match(/.{1,4}/g)?.join(" ") ?? "";
}

function saveJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function readJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The connection failed.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]!);
}
