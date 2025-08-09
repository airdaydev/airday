// types/browser.d.ts
declare global {
  interface Uint8ArrayConstructor {
    fromHex?(hex: string): Uint8Array;
  }
  interface Uint8Array {
    toHex?(): string;
  }
  interface Window {
    sendToPlaywright?: (message: any) => void;
    tests?: () => Promise<any>;
  }
}

export {};
