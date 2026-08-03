import {
  registeredStampHelperSchema,
  stampHelperStatusSchema,
  type RegisteredStampHelper,
  type StampHelperStatus
} from "@sibyl/protocol";

export class HelperRelayClient {
  constructor(private readonly relayUrl: string) {}

  async register(hpkePublicKey: string): Promise<RegisteredStampHelper> {
    return registeredStampHelperSchema.parse(
      await this.post("/v2/stamp-helpers/register", { hpkePublicKey })
    );
  }

  async status(registrationToken: string): Promise<StampHelperStatus> {
    return stampHelperStatusSchema.parse(
      await this.post("/v2/stamp-helpers/status", { registrationToken })
    );
  }

  async approve(
    registrationToken: string,
    linkCode: string
  ): Promise<StampHelperStatus> {
    return stampHelperStatusSchema.parse(
      await this.post("/v2/stamp-helpers/approve", {
        registrationToken,
        linkCode
      })
    );
  }

  async publishEncapsulation(
    registrationToken: string,
    hpkeEncapsulation: string
  ): Promise<StampHelperStatus> {
    return stampHelperStatusSchema.parse(
      await this.post("/v2/stamp-helpers/encapsulation", {
        registrationToken,
        hpkeEncapsulation
      })
    );
  }

  async confirm(registrationToken: string): Promise<StampHelperStatus> {
    return stampHelperStatusSchema.parse(
      await this.post("/v2/stamp-helpers/confirm", { registrationToken })
    );
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.relayUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`The helper connection failed (${response.status})`);
    }
    return response.json();
  }
}
