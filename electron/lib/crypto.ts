import { safeStorage } from 'electron'

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptString(plain: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption not available on this platform')
  }
  return safeStorage.encryptString(plain)
}

export function decryptString(buf: Buffer): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption not available on this platform')
  }
  return safeStorage.decryptString(buf)
}
