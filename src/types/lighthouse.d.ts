/**
 * lighthouse パッケージの型 shim (ルートに型定義がないため)。
 */
declare module 'lighthouse' {
  const lighthouse: (
    url: string,
    flags?: Record<string, unknown>,
    config?: unknown,
  ) => Promise<{ lhr: unknown }>;
  export default lighthouse;
}

declare module 'lighthouse/core/config/desktop-config.js' {
  const desktopConfig: unknown;
  export default desktopConfig;
}
