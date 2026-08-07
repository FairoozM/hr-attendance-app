import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Plus, UserPlus, Users } from 'lucide-react'
import { useAuth, hasPermission, canMutateInfluencerPerformance } from '../../contexts/AuthContext'
import { INFLUENCER_MODULE_TABS } from './influencerModuleNav'
import '../../pages/influencers/influencers.css'
import './InfluencerModuleLayout.css'

export function InfluencerModuleLayout() {
  const { user } = useAuth()
  const location = useLocation()

  const visibleTabs = INFLUENCER_MODULE_TABS.filter((tab) => (
    hasPermission(user, 'influencers', tab.action || 'view')
  ))

  const canAddContract = canMutateInfluencerPerformance(user)
  const canAddInfluencer = hasPermission(user, 'influencers', 'manage')

  function isTabActive(tabTo: string): boolean {
    if (tabTo.endsWith('/dashboard')) {
      return location.pathname === tabTo || location.pathname === '/influencers'
    }
    return location.pathname === tabTo || location.pathname.startsWith(`${tabTo}/`)
  }

  return (
    <div className="inf-page inf-module-layout">
      <header className="inf-module-layout__header inf-page-header">
        <div className="inf-module-layout__header-main">
          <span className="ip-eyebrow inf-module-layout__eyebrow">
            <Users size={15} aria-hidden /> Marketing / Social Media
          </span>
          <h1 className="inf-page-title inf-module-layout__title">Influencers</h1>
          <nav className="inf-module-subnav" aria-label="Influencer module sections">
            {visibleTabs.map((tab) => (
              <NavLink
                key={tab.key}
                to={tab.to}
                end={tab.key === 'dashboard'}
                className={() => (
                  isTabActive(tab.to) ? 'inf-module-subnav__link inf-module-subnav__link--active' : 'inf-module-subnav__link'
                )}
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
        {canAddContract || canAddInfluencer ? (
          <div className="inf-module-layout__actions">
            {canAddInfluencer ? (
              <NavLink to="/influencers/new" className="inf-btn inf-btn--ghost inf-module-layout__add-btn inf-module-layout__add-btn--secondary">
                <UserPlus size={16} aria-hidden /> Add Influencer
              </NavLink>
            ) : null}
            {canAddContract ? (
              <NavLink to="/influencers/performance?add=1" className="inf-btn inf-btn--primary inf-module-layout__add-btn">
                <Plus size={16} aria-hidden /> Add Contract
              </NavLink>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="inf-module-layout__content">
        <Outlet />
      </div>
    </div>
  )
}
