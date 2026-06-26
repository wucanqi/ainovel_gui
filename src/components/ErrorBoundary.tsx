import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex h-full items-center justify-center bg-[#10131a]">
          <div className="rounded-lg border border-rose-500/30 bg-[#121722] p-8 text-center max-w-md">
            <div className="text-4xl mb-4">⚠</div>
            <h2 className="text-lg font-semibold text-ink mb-2">出错了</h2>
            <p className="text-sm text-ink-soft mb-4">
              {this.state.error?.message ?? '发生未知错误'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
