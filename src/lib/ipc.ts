import type { Api } from '@shared/ipc-api'

declare global {
  interface Window {
    api: Api
  }
}

export const api = window.api
