export declare const DEFAULT_ZIP_URL: string;
export type InstallProgress = { phase: 'download'; got: number; total: number } | { phase: 'extract' };
export declare function installLibrary(
  dir: string,
  opts?: { url?: string; onProgress?: (p: InstallProgress) => void; fetchImpl?: typeof fetch },
): Promise<void>;
export declare function readLibrary(dir: string): Promise<{ ready: boolean; downloadedAt: string | null }>;
