import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

/** Temporary: surfaces render errors instead of a blank screen while debugging influencer performance. */
export class InfluencerPerformanceDebugBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Influencer Performance crashed:', error, info)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <pre style={{ whiteSpace: 'pre-wrap', padding: 16 }}>
          {String(this.state.error?.stack || this.state.error)}
        </pre>
      )
    }

    return this.props.children
  }
}
