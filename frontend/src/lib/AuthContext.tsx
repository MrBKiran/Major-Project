import React, { createContext, useContext, useState } from 'react'

export type UserRole = 'admin' | 'adviser' | 'customer' | 'quality' | 'security'

export interface UserProfile {
  id: string
  name: string
  email: string
  role: UserRole
  roleLabel: string
  avatarColor: string
  allowedTabs: string[]
  assignedVin?: string
}

export const USER_PERSONAS: Record<UserRole, UserProfile> = {
  admin: {
    id: 'usr_admin',
    name: 'Rajesh Sharma',
    email: 'admin@autosaarthi.ai',
    role: 'admin',
    roleLabel: 'Platform Administrator',
    avatarColor: 'bg-purple-600 text-white',
    allowedTabs: ['/', '/console', '/agents', '/ueba', '/plant', '/appointments']
  },
  adviser: {
    id: 'usr_adviser',
    name: 'Sunita Rao',
    email: 'adviser@autosaarthi.ai',
    role: 'adviser',
    roleLabel: 'Service Adviser',
    avatarColor: 'bg-emerald-600 text-white',
    allowedTabs: ['/', '/appointments', '/console']
  },
  customer: {
    id: 'usr_customer',
    name: 'Ramesh Kumar',
    email: 'ramesh@driver.in',
    role: 'customer',
    roleLabel: 'Vehicle Owner (Bolero B6)',
    avatarColor: 'bg-amber-600 text-white',
    allowedTabs: ['/console', '/appointments'],
    assignedVin: 'MH12AB1001'
  },
  quality: {
    id: 'usr_quality',
    name: 'Vikram Mehta',
    email: 'quality@pune-plant.in',
    role: 'quality',
    roleLabel: 'Plant Quality Engineer',
    avatarColor: 'bg-fuchsia-600 text-white',
    allowedTabs: ['/plant', '/', '/agents']
  },
  security: {
    id: 'usr_security',
    name: 'Priya Desai',
    email: 'security@autosaarthi.ai',
    role: 'security',
    roleLabel: 'UEBA Security Officer',
    avatarColor: 'bg-rose-600 text-white',
    allowedTabs: ['/ueba', '/agents', '/']
  }
}

interface AuthContextType {
  user: UserProfile | null
  loginAs: (role: UserRole) => void
  logout: () => void
  canAccess: (path: string) => boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Default to null so user arrives at the Login Page unless already logged in
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('autosaarthi_user_role') as UserRole | null
    return saved && USER_PERSONAS[saved] ? USER_PERSONAS[saved] : null
  })

  const loginAs = (role: UserRole) => {
    const profile = USER_PERSONAS[role]
    if (profile) {
      setUser(profile)
      localStorage.setItem('autosaarthi_user_role', role)
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('autosaarthi_user_role')
  }

  const canAccess = (path: string): boolean => {
    if (!user) return false
    if (user.role === 'admin') return true
    return user.allowedTabs.includes(path)
  }

  return (
    <AuthContext.Provider value={{ user, loginAs, logout, canAccess }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
