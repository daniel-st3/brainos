export function acquirePublic(
  url: string,
  limit?: number,
): Promise<{ url: string; bytes: Buffer; mime: string }>;
export function validateScenes(
  scenes: {
    type: string;
    asset: number;
    svg: string;
    video: {
      x: number;
      y: number;
      width: number;
      height: number;
      start: number;
      duration: number;
    };
  }[],
  assets: { sha256: string; mime: string; duration: number }[],
): void;
export function perceptualDuplicates(
  files: (string | Buffer)[],
): Promise<{ a: number; b: number; distance: number }[]>;
export function produceMixed(
  brief: unknown,
  directory: string,
): Promise<unknown>;

export function discoverSourceMedia(
  html: string,
  pageURL: string,
): {
  url: string;
  page_url: string;
  type: string;
  context: string;
  rights: string;
}[];
