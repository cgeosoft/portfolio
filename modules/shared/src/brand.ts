/**
 * Vendor identity shared by the service, the GUI and the desktop shell. These
 * are public values, so they live in code instead of a .env file.
 */
export const APP_NAME = "Portfolio";
export const APP_ID = "portfolio";
export const VENDOR_NAME = "cgeosoft";
export const VENDOR_URL = "https://cgeosoft.com";
/** Marketing site; also hosts terms, sponsor page and the release packages. */
export const WEBPAGE_URL = "https://portfolio.cgeosoft.com";
export const SUPPORT_EMAIL = "christos@cgeosoft.com";
export const GITHUB_URL = "https://github.com/cgeosoft/portfolio";
/** Manifest written by scripts/release.sh next to the packages on the website. */
export const RELEASE_MANIFEST_URL = `${WEBPAGE_URL}/releases/latest.json`;
