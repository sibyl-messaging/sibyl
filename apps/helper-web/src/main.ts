import QRCode from "qrcode";
import {
  formatPublicStampLabel,
  stampHelperQrPayloadSchema,
  type RegisteredStampHelper,
  type StampShare
} from "@sibyl/protocol";

import { HelperCryptoSession } from "./helperCrypto.js";
import { HelperRelayClient } from "./relayClient.js";
import "./style.css";

const POLL_INTERVAL_MS = 1_500;
const MAX_NETWORK_FAILURES = 5;
const relayUrl = (import.meta.env.VITE_RELAY_URL || window.location.origin).replace(/\/$/, "");
const relay = new HelperRelayClient(relayUrl);
const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("Missing app root");
}
const app: HTMLDivElement = appElement;

let cryptoSession: HelperCryptoSession | null = null;
let registration: RegisteredStampHelper | null = null;
let ownPublicKey: string | null = null;
let stamp: StampShare | null = null;
let pollTimer: number | null = null;
let stopped = false;
let networkFailures = 0;
let codePromptVisible = false;

const mode = new URLSearchParams(window.location.search).get("mode");

if (mode === "getting-started") {
  renderGettingStarted();
} else if (mode === "about") {
  renderAbout();
} else if (mode === "choose-phone") {
  renderPhoneChoice();
} else if (mode === "helper") {
  void start();
  window.addEventListener("pagehide", destroySecrets, { once: true });
} else if (mode === "main") {
  void import("./mainPhone.js").then(({ startMainPhone }) => {
    startMainPhone(app, relayUrl);
  });
} else {
  renderWelcome();
}

function renderWelcome(): void {
  app.innerHTML = pageShell(`
    <section class="step role-step" aria-labelledby="welcome-title">
      <h1 id="welcome-title">A messaging app where readable messages stay on paper.</h1>
      <p class="detail">Your phone sends and receives only scrambled letters.</p>
      <a class="primary-button button-link" href="?mode=getting-started">Get started</a>
      <nav class="learn-links" aria-label="More options">
        <a class="text-link" href="?mode=choose-phone">I already know what to do</a>
        <a class="text-link" href="?mode=about">Why it works</a>
      </nav>
    </section>
  `);
}

function renderPhoneChoice(): void {
  app.innerHTML = pageShell(`
    <section class="step role-step" aria-labelledby="phone-title">
      <p class="eyebrow">Phone setup</p>
      <h1 id="phone-title">Which phone is this?</h1>
      <p class="detail">Choose the phone in your hand.</p>
      <a class="primary-button button-link" href="?mode=main">My main phone</a>
      <a class="secondary-button button-link" href="?mode=helper">A borrowed phone</a>
      <a class="text-link" href="./">Back to home</a>
    </section>
  `);
}

function renderGettingStarted(): void {
  app.innerHTML = pageShell(`
    <article class="about-step getting-started-step" aria-labelledby="getting-started-title">
      <p class="eyebrow">Getting started</p>
      <h1 id="getting-started-title">Build your paper wheel first.</h1>
      <p class="about-intro">Print it, assemble it, and pass the two-letter test before borrowing any phones.</p>

      <section class="explain-section" aria-labelledby="print-title">
        <p class="section-number">1</p>
        <h2 id="print-title">Print the right size</h2>
        <p>Use US Letter in the United States or Canada. Most other countries use A4.</p>
        <div class="print-actions">
          <a class="primary-button button-link" href="/printouts/paper-cipher-wheel-us-letter.pdf" target="_blank" rel="noopener">Open US Letter PDF</a>
          <a class="secondary-button button-link" href="/printouts/paper-cipher-wheel-a4.pdf" target="_blank" rel="noopener">Open A4 PDF</a>
        </div>
        <p class="print-warning"><strong>Print at 100% or Actual Size.</strong> Turn off “Fit to Page.” The line on page 1 must measure exactly 100 mm.</p>
      </section>

      <section class="explain-section" aria-labelledby="build-title">
        <p class="section-number">2</p>
        <h2 id="build-title">Cut and assemble</h2>
        <ol class="plain-steps">
          <li>Cut out both dashed circles on page 1.</li>
          <li>Place the small wheel on top of the large wheel.</li>
          <li>Match the two center marks.</li>
          <li>Join the centers with a brass paper fastener so the small wheel can turn.</li>
        </ol>
        <p>You need scissors, a pin or hole punch, and one brass paper fastener.</p>
      </section>

      <section class="explain-section" aria-labelledby="test-title">
        <p class="section-number">3</p>
        <h2 id="test-title">Test the wheel</h2>
        <ol class="plain-steps">
          <li>Turn the blue KEY arrow to <strong>03</strong>.</li>
          <li>Find <strong>H</strong> on the inner wheel. The outer wheel should show <strong>K</strong>.</li>
          <li>Turn the blue KEY arrow to <strong>01</strong>.</li>
          <li>Find <strong>I</strong> on the inner wheel. The outer wheel should show <strong>J</strong>.</li>
        </ol>
        <p class="test-result">If <strong>HI</strong> becomes <strong>KJ</strong>, your wheel works.</p>
      </section>

      <section class="explain-section" aria-labelledby="gather-title">
        <p class="section-number">4</p>
        <h2 id="gather-title">Gather both sides</h2>
        <p>Alice and Bob each need:</p>
        <ul class="supply-list">
          <li>their own main phone</li>
          <li>one assembled paper wheel</li>
          <li>paper and a pen</li>
          <li>at least two different borrowed phones</li>
        </ul>
        <p>Both people should be available at the same time while making the paper stamps.</p>
      </section>

      <a class="primary-button button-link about-back" href="?mode=choose-phone">Continue to phone setup</a>
      <a class="text-link about-home" href="./">Back to home</a>
    </article>
  `);
}

function renderAbout(): void {
  app.innerHTML = pageShell(`
    <article class="about-step" aria-labelledby="about-title">
      <p class="eyebrow">Why Sibyl exists</p>
      <h1 id="about-title">If your phone is hacked, encryption cannot hide what you type and read.</h1>
      <p class="about-intro">Encryption protects a message while it travels. But normal messaging still puts the readable words on your phone and your friend’s phone.</p>

      <section class="explain-section" aria-labelledby="problem-title">
        <h2 id="problem-title">The attacker does not need to break the encryption</h2>
        <p>If spyware can watch your keyboard or screen, it can copy the message before it is encrypted or after it is decrypted. It does not need to break the encryption at all.</p>
        <p>That is the problem Sibyl is designed for.</p>
      </section>

      <section class="explain-section" aria-labelledby="different-title">
        <h2 id="different-title">Sibyl keeps the readable message off the phone</h2>
        <p>Alice writes her real message on paper. She uses the paper wheel and paper stamp to turn it into scrambled letters. Only those scrambled letters go into her main phone and across the internet.</p>
        <p>Bob’s main phone shows the scrambled letters. He copies them onto paper and uses his matching paper stamp to make the message readable again.</p>
        <p><strong>The readable message never appears on either main-phone screen.</strong> A hacker watching either main phone sees only scrambled letters.</p>
      </section>

      <section class="explain-section" aria-labelledby="phones-title">
        <h2 id="phones-title">Why borrow several separate phones?</h2>
        <p>Alice and Bob do not share phones and do not need to meet. Alice borrows one phone near her. Bob separately borrows another phone near him. The app pairs those two phones so they create the same random paper part at both ends.</p>
        <p>They repeat this with at least two separate phone pairs. Each borrowed phone knows only one part. The main phones and server never receive any of the parts.</p>
        <p>So hacking one main phone is not enough. To read the message, an attacker would also need every paper part from one side—or control every borrowed phone used on that side.</p>
      </section>

      <section class="explain-section" aria-labelledby="reuse-title">
        <h2 id="reuse-title">Why cross out each stamp?</h2>
        <p>One complete paper stamp protects one message of up to 26 letters. Reusing the same numbers can reveal patterns between messages, so both people cross out the stamp after using it.</p>
      </section>

      <section class="explain-section limits-section" aria-labelledby="limits-title">
        <h2 id="limits-title">What Sibyl does not protect</h2>
        <p>Sibyl protects the readable content, not everything around it. The server can still see which accounts exchanged data, when it happened, and the message length. It could also block or damage a message.</p>
        <p>If someone watches the paper, gets every paper part from one side, controls every borrowed phone used on that side, or you type the real message into a phone, the message is no longer protected.</p>
        <p class="prototype-note">Sibyl is an experimental prototype. It has not been independently security-audited.</p>
      </section>

      <a class="secondary-button button-link about-back" href="./">Back to home</a>
    </article>
  `);
}

async function start(): Promise<void> {
  destroySecrets();
  stopped = false;
  networkFailures = 0;
  codePromptVisible = false;
  renderStatus("Preparing this phone…", "Keep this page open.");

  try {
    if (!window.isSecureContext || !crypto?.subtle) {
      throw new Error("Open this page using a secure HTTPS link");
    }
    cryptoSession = await HelperCryptoSession.create();
    ownPublicKey = await cryptoSession.publicKeyBase64();
    registration = await relay.register(ownPublicKey);
    if (registration.hpkePublicKey !== ownPublicKey) {
      throw new Error("The helper key was changed during registration");
    }
    await renderQr(registration.registrationId);
    schedulePoll(0);
  } catch (error) {
    fail(error);
  }
}

async function poll(): Promise<void> {
  if (stopped || !registration || stamp) return;
  try {
    const status = await relay.status(registration.registrationToken);
    networkFailures = 0;
    if (!ownPublicKey || status.ownHpkePublicKey !== ownPublicKey) {
      throw new Error("The helper key changed while connecting");
    }
    if (Date.now() >= status.expiresAtMs) {
      throw new Error("This paper stamp setup expired");
    }

    if (status.state === "waiting_for_scan") {
      schedulePoll();
      return;
    }
    if (status.state === "waiting_for_code") {
      if (!codePromptVisible) renderLinkCode();
      return;
    }
    if (status.state === "waiting_for_partner") {
      renderWaitingForPartner(status.shareIndex);
      schedulePoll();
      return;
    }
    if (
      !cryptoSession ||
      !status.role ||
      !status.shareContext ||
      status.shareIndex === null
    ) {
      throw new Error("This helper session is incomplete");
    }

    if (status.role === "initiator") {
      renderStatus("Making the paper stamp…", "This stays on the borrowed phones.");
      const result = await cryptoSession.deriveAsInitiator(status);
      await relay.publishEncapsulation(
        registration.registrationToken,
        result.hpkeEncapsulation
      );
      stamp = result.stamp;
      renderStamp(stamp, status.shareContext.bundleId, status.shareIndex);
      return;
    }

    if (!status.hpkeEncapsulation) {
      renderStatus("Both phones are connected.", "Making the paper stamp…");
      schedulePoll();
      return;
    }
    stamp = await cryptoSession.deriveAsRecipient(status);
    renderStamp(stamp, status.shareContext.bundleId, status.shareIndex);
  } catch (error) {
    if (isNetworkError(error) && networkFailures < MAX_NETWORK_FAILURES) {
      networkFailures += 1;
      renderStatus("Connection paused.", "Trying again…");
      schedulePoll();
      return;
    }
    fail(error);
  }
}

function renderLinkCode(): void {
  codePromptVisible = true;
  app.innerHTML = pageShell(`
    <section class="step code-step" aria-labelledby="step-title">
      <p class="eyebrow">Main phone scanned</p>
      <h1 id="step-title">Type its six digits.</h1>
      <p class="detail">Ask the person holding the main phone.</p>
      <label class="code-label" for="link-code">Six-digit code</label>
      <input
        class="code-input"
        id="link-code"
        name="link-code"
        type="text"
        inputmode="numeric"
        pattern="[0-9]{6}"
        maxlength="6"
        autocomplete="off"
        aria-describedby="code-error"
      />
      <p class="code-error" id="code-error" aria-live="polite"></p>
      <button class="primary-button" type="button" id="link-button">Link this phone</button>
    </section>
  `);
  const input = document.querySelector<HTMLInputElement>("#link-code");
  input?.addEventListener("input", () => {
    if (input) input.value = input.value.replace(/\D/g, "").slice(0, 6);
  });
  document.querySelector<HTMLButtonElement>("#link-button")?.addEventListener(
    "click",
    () => void approveLinkCode()
  );
  input?.focus();
}

async function approveLinkCode(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#link-code");
  const button = document.querySelector<HTMLButtonElement>("#link-button");
  const error = document.querySelector<HTMLElement>("#code-error");
  if (!registration || !input || !button || !error) return;
  if (!/^\d{6}$/.test(input.value)) {
    error.textContent = "Enter all six digits.";
    input.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "Linking…";
  error.textContent = "";
  try {
    const status = await relay.approve(registration.registrationToken, input.value);
    input.value = "";
    codePromptVisible = false;
    renderWaitingForPartner(status.shareIndex);
    schedulePoll(0);
  } catch {
    button.disabled = false;
    button.textContent = "Try this code";
    error.textContent = "Those digits did not match. Check the main phone.";
    input.focus();
  }
}

async function renderQr(registrationId: string): Promise<void> {
  const qrPayload = stampHelperQrPayloadSchema.parse({
    version: 2,
    registrationId
  });
  const qrUrl = await QRCode.toDataURL(JSON.stringify(qrPayload), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
    color: { dark: "#17201B", light: "#FFFFFF" }
  });
  app.innerHTML = pageShell(`
    <section class="step" aria-labelledby="step-title">
      <p class="eyebrow">Borrowed phone</p>
      <h1 id="step-title">Let the main phone scan this.</h1>
      <div class="qr-frame">
        <img class="qr" src="${qrUrl}" alt="Public helper QR code" width="320" height="320" />
      </div>
      <p class="plain-instruction"><strong>This phone shows.</strong> Their phone scans.</p>
      <p class="privacy-note">This QR contains no paper-stamp numbers.</p>
    </section>
  `);
}

function renderStatus(title: string, detail: string): void {
  app.innerHTML = pageShell(`
    <section class="step status-step" aria-labelledby="step-title" aria-live="polite">
      <div class="pulse-mark" aria-hidden="true"><span></span></div>
      <h1 id="step-title">${escapeHtml(title)}</h1>
      <p class="detail">${escapeHtml(detail)}</p>
    </section>
  `);
}

function renderWaitingForPartner(shareIndex: number | null): void {
  const phoneNumber = shareIndex === null ? "matching phone" : `Phone ${shareIndex + 1}`;
  renderStatus(
    "Linked. Keep this open.",
    `The numbers appear after the other person links ${phoneNumber}.`
  );
}

function renderStamp(
  values: StampShare,
  bundleId: string,
  shareIndex: number
): void {
  const stampLabel = formatPublicStampLabel(bundleId);
  const rows = Array.from({ length: 13 }, (_, index) => {
    const secondIndex = index + 13;
    return `<div class="stamp-row">
      ${stampEntry(index, values[index]!)}
      ${stampEntry(secondIndex, values[secondIndex]!)}
    </div>`;
  }).join("");
  app.innerHTML = pageShell(`
    <section class="step stamp-step" aria-labelledby="step-title">
      <p class="eyebrow">${stampLabel} · Part ${shareIndex + 1}</p>
      <h1 id="step-title">Copy these 26 numbers.</h1>
      <p class="detail">First write “${stampLabel} · Part ${shareIndex + 1}.” Then copy the numbers.</p>
      <div class="paper-strip" aria-label="Your 26 paper stamp numbers">${rows}</div>
      <button class="primary-button" type="button" id="copied-button">I copied all 26</button>
      <p class="privacy-note">Do not photograph this screen.</p>
    </section>
  `);
  document.querySelector<HTMLButtonElement>("#copied-button")?.addEventListener(
    "click",
    () => void confirmCopied()
  );
}

async function confirmCopied(): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>("#copied-button");
  if (!registration || !button) return;
  button.disabled = true;
  button.textContent = "Finishing…";
  try {
    await relay.confirm(registration.registrationToken);
    destroySecrets();
    renderDone();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Try finishing again";
    const message = document.querySelector(".privacy-note");
    if (message) message.textContent = friendlyError(error);
  }
}

function renderDone(): void {
  app.innerHTML = pageShell(`
    <section class="step done-step" aria-labelledby="step-title" aria-live="polite">
      <div class="done-mark" aria-hidden="true">✓</div>
      <p class="eyebrow">Numbers erased</p>
      <h1 id="step-title">Done. Return this phone.</h1>
      <p class="detail">The paper stamp is the only copy left here.</p>
    </section>
  `);
}

function fail(error: unknown): void {
  destroySecrets();
  app.innerHTML = pageShell(`
    <section class="step error-step" aria-labelledby="step-title" aria-live="assertive">
      <p class="eyebrow">Couldn’t finish</p>
      <h1 id="step-title">Start this phone again.</h1>
      <p class="detail">${escapeHtml(friendlyError(error))}</p>
      <button class="primary-button" type="button" id="retry-button">Start again</button>
    </section>
  `);
  document.querySelector<HTMLButtonElement>("#retry-button")?.addEventListener(
    "click",
    () => void start()
  );
}

function destroySecrets(): void {
  stopped = true;
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = null;
  if (stamp) stamp.fill(0);
  stamp = null;
  cryptoSession?.destroy();
  cryptoSession = null;
  ownPublicKey = null;
  registration = null;
  codePromptVisible = false;
}

function schedulePoll(delay = POLL_INTERVAL_MS): void {
  if (stopped) return;
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(() => void poll(), delay);
}

function pageShell(content: string): string {
  return `<main class="shell">
    <div class="wordmark" aria-label="Sibyl"><span aria-hidden="true">S</span> Sibyl</div>
    ${content}
    <footer>You can’t hack paper.</footer>
  </main>`;
}

function stampEntry(index: number, value: number): string {
  return `<div class="stamp-entry">
    <span class="stamp-index">${String(index + 1).padStart(2, "0")}</span>
    <strong>${String(value).padStart(2, "0")}</strong>
  </div>`;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && /connection failed \(5\d\d\)/.test(error.message));
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : "Check the connection and try again.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]!);
}
