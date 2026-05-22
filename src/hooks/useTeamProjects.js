/**
 * useTeamProjects.js
 *
 * Convenience hook wrapping TeamProjectsContext.
 * Equivalent to calling useTeamProjectsContext() directly, but gives a
 * stable, consistent import alias for page components.
 *
 * Usage:
 *   const { projects, members, loadingProjects, actions } = useTeamProjects()
 */

import { useTeamProjectsContext } from '../contexts/TeamProjectsContext'

export function useTeamProjects() {
  return useTeamProjectsContext()
}

export default useTeamProjects
