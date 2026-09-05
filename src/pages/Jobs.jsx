import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Repeat, Heart, Bookmark, MessageCircle, Clock, CheckCircle2, XCircle,
  Loader2, ExternalLink, AlertCircle, Filter
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatRelativeTime, formatDateTime, getStatusBadgeClass } from '../lib/utils'

const actionIcons = { retweet: Repeat, like: Heart, bookmark: Bookmark, reply: MessageCircle }
const actionColors = { retweet: 'text-primary-400', like: 'text-error-400', bookmark: 'text-accent-400', reply: 'text-success-400' }

export default function Jobs() {
  const { user } = useAuth()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [activity, setActivity] = useState([])
  const [tab, setTab] = useState('jobs')

  const fetchJobs = useCallback(async () => {
    let query = supabase
      .from('action_jobs')
      .select(`
        id, action_type, status, scheduled_for, started_at, completed_at,
        retry_count, error_message, created_at,
        x_accounts!inner(username),
        tweets!inner(x_post_id, author_username, post_url)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (filter !== 'all') {
      query = query.eq('status', filter)
    }

    const { data } = await query
    setJobs(data || [])
    setLoading(false)
  }, [user, filter])

  const fetchActivity = useCallback(async () => {
    const { data } = await supabase
      .from('activity_logs')
      .select('id, event_type, message, metadata, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setActivity(data || [])
  }, [user])

  useEffect(() => {
    fetchJobs()
    if (tab === 'activity') fetchActivity()
  }, [fetchJobs, fetchActivity, tab])

  const filters = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'processing', label: 'Processing' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
  ]

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Jobs & Activity</h1>
        <p className="text-sm text-neutral-500">Track automation jobs and system activity</p>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-neutral-900 p-1 rounded-lg border border-neutral-800 w-fit">
        <button
          onClick={() => setTab('jobs')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'jobs' ? 'bg-primary-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
        >Jobs</button>
        <button
          onClick={() => setTab('activity')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'activity' ? 'bg-primary-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
        >Activity Log</button>
      </div>

      {tab === 'jobs' && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
            <Filter className="w-4 h-4 text-neutral-500 flex-shrink-0" />
            {filters.map((f) => (
              <button
                key={f.value}
                onClick={() => { setFilter(f.value); setLoading(true) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  filter === f.value ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="w-16 h-16 mx-auto bg-neutral-800 rounded-2xl flex items-center justify-center mb-4">
                <Clock className="w-8 h-8 text-neutral-500" />
              </div>
              <h3 className="text-lg font-semibold mb-1">No jobs yet</h3>
              <p className="text-sm text-neutral-500">Jobs will appear here when automations detect new posts.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job, i) => {
                const ActionIcon = actionIcons[job.action_type] || Clock
                const xAccount = job.x_accounts
                const tweet = job.tweets
                return (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="card p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center flex-shrink-0`}>
                        <ActionIcon className={`w-4 h-4 ${actionColors[job.action_type] || 'text-neutral-400'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm capitalize">{job.action_type}</span>
                          <span className={getStatusBadgeClass(job.status)}>{job.status}</span>
                          <span className="text-xs text-neutral-500">@{xAccount?.username || '—'}</span>
                        </div>
                        <div className="mt-1.5 text-xs text-neutral-500 space-y-0.5">
                          <p>Tweet by @{tweet?.author_username || '—'} — {formatRelativeTime(job.created_at)}</p>
                          <p>Scheduled: {formatDateTime(job.scheduled_for)}</p>
                          {job.started_at && <p>Started: {formatDateTime(job.started_at)}</p>}
                          {job.completed_at && <p>Completed: {formatDateTime(job.completed_at)}</p>}
                          {job.retry_count > 0 && <p>Retries: {job.retry_count}</p>}
                        </div>
                        {job.error_message && (
                          <div className="mt-2 p-2 bg-error-500/10 border border-error-500/20 rounded text-xs text-error-400 flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                            <span>{job.error_message}</span>
                          </div>
                        )}
                      </div>
                      {tweet?.post_url && (
                        <a
                          href={tweet.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-ghost p-1.5 flex-shrink-0"
                          title="View post on X"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'activity' && (
        <div className="space-y-2">
          {activity.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-sm text-neutral-500">No activity logged yet.</p>
            </div>
          ) : (
            activity.map((log, i) => (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className="card p-3 flex items-start gap-3"
              >
                <div className="w-2 h-2 rounded-full bg-primary-500 mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-200">{log.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-neutral-500">{formatRelativeTime(log.created_at)}</span>
                    <span className="text-xs text-neutral-600">·</span>
                    <span className="text-xs text-neutral-500 font-mono">{log.event_type}</span>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
