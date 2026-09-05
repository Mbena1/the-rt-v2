import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Bird, Eye, Zap, CheckCircle2, XCircle, Clock, Loader2,
  TrendingUp, Activity as ActivityIcon
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatRelativeTime } from '../lib/utils'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchDashboard = useCallback(async () => {
    const [xAccountsRes, monitoredRes, rulesRes, jobsRes, activityRes] = await Promise.all([
      supabase.from('x_accounts').select('id, status').eq('user_id', user.id),
      supabase.from('monitored_accounts').select('id, status').eq('user_id', user.id),
      supabase.from('automation_rules').select('id, enabled').eq('user_id', user.id),
      supabase.from('action_jobs').select('id, status').eq('user_id', user.id),
      supabase.from('activity_logs').select('id, event_type, message, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
    ])

    const jobs = jobsRes.data || []
    setStats({
      xAccounts: xAccountsRes.data?.length || 0,
      xAccountsActive: (xAccountsRes.data || []).filter(a => a.status === 'active').length,
      monitored: monitoredRes.data?.length || 0,
      monitoredActive: (monitoredRes.data || []).filter(a => a.status === 'monitoring').length,
      rules: rulesRes.data?.length || 0,
      rulesActive: (rulesRes.data || []).filter(r => r.enabled).length,
      jobsPending: jobs.filter(j => j.status === 'pending' || j.status === 'scheduled').length,
      jobsProcessing: jobs.filter(j => j.status === 'processing').length,
      jobsCompleted: jobs.filter(j => j.status === 'completed').length,
      jobsFailed: jobs.filter(j => j.status === 'failed').length,
    })
    setActivity(activityRes.data || [])
    setLoading(false)
  }, [user])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const statCards = [
    { label: 'Connected X Accounts', value: stats.xAccounts, sub: stats.xAccountsActive + ' active', icon: Bird, iconBg: 'bg-primary-500/10', iconText: 'text-primary-400' },
    { label: 'Monitored Accounts', value: stats.monitored, sub: stats.monitoredActive + ' monitoring', icon: Eye, iconBg: 'bg-accent-500/10', iconText: 'text-accent-400' },
    { label: 'Active Automations', value: stats.rulesActive, sub: stats.rules + ' total rules', icon: Zap, iconBg: 'bg-success-500/10', iconText: 'text-success-400' },
    { label: 'Jobs Completed', value: stats.jobsCompleted, sub: stats.jobsFailed + ' failed', icon: TrendingUp, iconBg: 'bg-warning-500/10', iconText: 'text-warning-400' },
  ]

  const jobStats = [
    { label: 'Pending', value: stats.jobsPending, icon: Clock, color: 'text-primary-400' },
    { label: 'Processing', value: stats.jobsProcessing, icon: Loader2, color: 'text-warning-400' },
    { label: 'Completed', value: stats.jobsCompleted, icon: CheckCircle2, color: 'text-success-400' },
    { label: 'Failed', value: stats.jobsFailed, icon: XCircle, color: 'text-error-400' },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
        <p className="text-sm text-neutral-500 mb-8">Overview of your X automation activity</p>
      </motion.div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card p-5"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center`}>
                <card.icon className={`w-5 h-5 ${card.iconText}`} />
              </div>
              <span className="text-2xl font-bold">{card.value}</span>
            </div>
            <p className="text-sm font-medium text-neutral-300">{card.label}</p>
            <p className="text-xs text-neutral-500 mt-0.5">{card.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Job stats */}
      <div className="card p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Job Status Overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {jobStats.map((stat) => (
            <div key={stat.label} className="flex items-center gap-3 p-3 bg-neutral-800/40 rounded-lg">
              <stat.icon className={`w-5 h-5 ${stat.color}`} />
              <div>
                <p className="text-xl font-bold">{stat.value}</p>
                <p className="text-xs text-neutral-500">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <ActivityIcon className="w-5 h-5 text-neutral-400" />
          <h2 className="text-lg font-semibold">Recent Activity</h2>
        </div>
        {activity.length === 0 ? (
          <p className="text-sm text-neutral-500 py-8 text-center">No activity yet. Start by connecting an X account and setting up automations.</p>
        ) : (
          <div className="space-y-2">
            {activity.map((log) => (
              <div key={log.id} className="flex items-start gap-3 p-3 hover:bg-neutral-800/40 rounded-lg transition-colors">
                <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200">{log.message}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">{formatRelativeTime(log.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
