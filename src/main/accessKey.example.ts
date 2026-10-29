/**
 * Copy this file to accessKey.ts (not in git) and put the real key in it. Every installer must be built
 * with the same key as the PCs already in use, or their access codes will not match. A new key:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export const ACCESS_KEY_HEX = 'replace-with-64-hex-characters'
