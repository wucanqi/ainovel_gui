import { randomUUID } from 'crypto'

export function uuid(): string {
  return randomUUID()
}

export function now(): number {
  return Date.now()
}
