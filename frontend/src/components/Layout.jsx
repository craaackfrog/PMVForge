import { NavLink } from 'react-router-dom'
import { APP_NAME } from '../lib/config'
import { cn } from '../lib/utils'
import {
  Home,
  Music2,
  Pencil,
  Film,
  History,
  Settings,
  Heart,
  Library,
} from 'lucide-react'

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/beats', label: 'Beat Creator', icon: Music2 },
  { to: '/editor', label: 'Beat Editor', icon: Pencil },
  { to: '/generate', label: 'PMV Creator', icon: Film },
  { to: '/cockhero', label: 'CH Creator', icon: Heart },
  { to: '/libraries', label: 'Clip Libraries', icon: Library },
  { to: '/songs', label: 'Song Libraries', icon: Music2 },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col" id="nav">
        <div className="px-5 py-6">
          <h1 className="font-serif text-2xl tracking-tight text-foreground">
            {APP_NAME}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Local PMV studio
          </p>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )
              }
            >
              <Icon size={18} strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>

      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-[90rem] mx-auto px-6 py-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
