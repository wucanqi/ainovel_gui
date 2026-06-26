import { LoadState, Route, formatInstruction } from './flow-router'
import type { Instruction } from '@shared/types'

export interface DispatcherEvents {
  onInstruction: (inst: Instruction, repeatN: number) => void
  onRepeat: (agent: string, task: string, count: number) => void
}

export class FlowDispatcher {
  private lastInstruction: { agent: string; task: string } | null = null
  private repeatCount = 0
  private events: DispatcherEvents | null = null
  private _enabled = false

  setEvents(e: DispatcherEvents): void {
    this.events = e
  }

  enable(): void {
    this._enabled = true
  }

  disable(): void {
    this._enabled = false
  }

  reset(): void {
    this.lastInstruction = null
    this.repeatCount = 0
  }

  dispatch(projectId: string): void {
    if (!this._enabled) return
    const state = LoadState(projectId)
    const inst = Route(state)
    if (!inst) return

    const n = this.trackRepeat(inst)
    const msg = formatInstruction(inst, n)
    this.events?.onInstruction(inst, n)
  }

  private trackRepeat(inst: Instruction): number {
    if (this.lastInstruction && this.lastInstruction.agent === inst.agent && this.lastInstruction.task === inst.task) {
      this.repeatCount++
    } else {
      this.lastInstruction = { agent: inst.agent, task: inst.task }
      this.repeatCount = 1
    }
    if (this.repeatCount === 3) {
      this.events?.onRepeat(inst.agent, inst.task, this.repeatCount)
    }
    return this.repeatCount
  }
}
