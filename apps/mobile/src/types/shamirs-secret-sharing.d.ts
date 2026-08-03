declare module "shamirs-secret-sharing" {
  export interface SplitOptions {
    shares: number;
    threshold: number;
  }

  export interface ShamirSecretSharing {
    split(secret: Uint8Array, options: SplitOptions): Uint8Array[];
    combine(shares: Uint8Array[]): Uint8Array;
  }

  const sss: ShamirSecretSharing;
  export default sss;
}
