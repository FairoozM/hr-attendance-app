import { Component } from 'react'

/** Temporary: surfaces render errors instead of a blank screen while debugging influencer performance. */
export class InfluencerPerformanceDebugBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Influencer Performance crashed:', error, info)
  }

  render() {
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
