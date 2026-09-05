import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Eye, Plus, Trash2, Pause, Play, AlertCircle, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatRelativeTime, getStatusBadgeClass } from '../lib/utils'

export default function MonitoredAccounts() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [username, setUsername] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const fetchAccounts = useCallback(async () => {
    const { data } = await supabase
      .from('monitored_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setAccounts(data || [])
    setLoading(false)
  }, [user])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  const handleAdd = async (e) => {
    e.preventDefault()
    setError('')
    const cleanUsername = username.trim().replace(/^@/, '')
    if (!cleanUsername) {
      setError('Please enter a username')
      return
    }

    setAdding(true)
    try {
      // Resolve X user ID via the bearer token through a fetch to the edge function
      // For now, we store with the username as the x_user_id placeholder
      // The monitor function will use the x_user_id field
      const bearerToken = import.meta.env.VITE_X_BEARER_TOKEN
      let xUserId = cleanUsername

      if (bearerToken) {
        try {
          const res = await fetch(
            'https://api.twitter.com/2/users/by/username/' + cleanUsername,
            { headers: { Authorization: 'Bearer ' + bearerToken } }
          )
          if (res.ok) {
            const userData = await res.json()
            if (userData.data && userData.data.id) {
              xUserId = userData.data.id
            }
          }
        } catch {
          // Fall back to username if API resolution fails
        }
      }

      const { error: insertError } = await supabase
        .from('monitored_accounts')
        .insert({
          user_id: user.id,
          x_user_id: xUserId,
          username: cleanUsername,
          status: 'monitoring',
        })

      if (insertError) {
        if (insertError.code === '23505') {
          setError('This account is already being monitored')
        } else {
          setError(insertError.message)
        }
      } else {
        setUsername('')
        setShowAdd(false)
        fetchAccounts()
      }
    } catch (err) {
      setError(err.message)
    }
    setAdding(false)
  }

  const handleToggleStatus = async (account) => {
    const newStatus = account.status === 'monitoring' ? 'paused' : 'monitoring'
    await supabase
      .from('monitored_accounts')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', account.id)
    fetchAccounts()
  }

  const handleDelete = async (id) => {
    if (!confirm('Stop monitoring this account? Related automations will be deleted.')) return
    await supabase.from('monitored_accounts').delete().eq('id', id)
    fetchAccounts()
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Monitored Accounts</h1>
          <p className="text-sm text-neutral-500">X accounts being watched for new posts</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </motion.div>

      {showAdd && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-6 mb-6">
          <h3 className="font-semibold mb-4">Add Monitored Account</h3>
          {error && (
            <div className="mb-4 p-3 bg-error-500/10 border border-error-500/20 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-error-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-error-400">{error}</p>
            </div>
          )}
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">X Username</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">@</span>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field pl-8"
                  placeholder="username"
                />
              </div>
              <p className="text-xs text-neutral-500 mt-1.5">The account whose new posts will trigger automations.</p>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={adding} className="btn-primary">
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Monitoring'}
              </button>
              <button type="button" onClick={() => { setShowAdd(false); setError('') }} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </motion.div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 mx-auto bg-neutral-800 rounded-2xl flex items-center justify-center mb-4">
            <Eye className="w-8 h-8 text-neutral-500" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No monitored accounts</h3>
          <p className="text-sm text-neutral-500 mb-6 max-w-sm mx-auto">
            Add an X account to monitor. When they post, your automation rules will trigger automatically.
          </p>
          <button onClick={() => setShowAdd(true)} className="btn-primary mx-auto">
            <Plus className="w-4 h-4" />
            Add Account
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account, i) => (
            <motion.div
              key={account.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card p-5"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center flex-shrink-0">
                  <Eye className="w-5 h-5 text-neutral-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">@{account.username}</h3>
                    <span className={getStatusBadgeClass(account.status)}>{account.status}</span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Last checked: {formatRelativeTime(account.last_checked_at)}
                  </p>
                  {account.last_error && (
                    <p className="text-xs text-error-400 mt-1 truncate">{account.last_error}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleStatus(account)}
                    className="btn-ghost"
                    title={account.status === 'monitoring' ? 'Pause' : 'Resume'}
                  >
                    {account.status === 'monitoring' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="btn-ghost text-neutral-400 hover:text-error-400"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
