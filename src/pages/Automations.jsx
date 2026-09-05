import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, Plus, Trash2, Pencil, Repeat, Heart, Bookmark, MessageCircle, X,
  AlertCircle, Loader2, Eye, Bird, Pause, Play
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getStatusBadgeClass } from '../lib/utils'

export default function Automations() {
  const { user } = useAuth()
  const [rules, setRules] = useState([])
  const [xAccounts, setXAccounts] = useState([])
  const [monitoredAccounts, setMonitoredAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    monitored_account_id: '',
    x_account_id: '',
    enabled: true,
    do_retweet: true,
    retweet_delay_seconds: 60,
    do_like: false,
    like_delay_seconds: 60,
    do_bookmark: false,
    bookmark_delay_seconds: 60,
    do_reply: false,
    reply_delay_seconds: 60,
    reply_text: '',
  })

  const fetchData = useCallback(async () => {
    const [rulesRes, xRes, monRes] = await Promise.all([
      supabase.from('automation_rules').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('x_accounts').select('id, username, display_name, status').eq('user_id', user.id).eq('status', 'active'),
      supabase.from('monitored_accounts').select('id, username, status').eq('user_id', user.id),
    ])
    setRules(rulesRes.data || [])
    setXAccounts(xRes.data || [])
    setMonitoredAccounts(monRes.data || [])
    setLoading(false)
  }, [user])

  useEffect(() => { fetchData() }, [fetchData])

  const resetForm = () => {
    setForm({
      monitored_account_id: '', x_account_id: '', enabled: true,
      do_retweet: true, retweet_delay_seconds: 60,
      do_like: false, like_delay_seconds: 60,
      do_bookmark: false, bookmark_delay_seconds: 60,
      do_reply: false, reply_delay_seconds: 60,
      reply_text: '',
    })
    setEditing(null)
    setError('')
  }

  const openCreate = () => { resetForm(); setShowModal(true) }

  const openEdit = (rule) => {
    setForm({
      monitored_account_id: rule.monitored_account_id,
      x_account_id: rule.x_account_id,
      enabled: rule.enabled,
      do_retweet: rule.do_retweet,
      retweet_delay_seconds: rule.retweet_delay_seconds,
      do_like: rule.do_like,
      like_delay_seconds: rule.like_delay_seconds,
      do_bookmark: rule.do_bookmark,
      bookmark_delay_seconds: rule.bookmark_delay_seconds,
      do_reply: rule.do_reply,
      reply_delay_seconds: rule.reply_delay_seconds,
      reply_text: rule.reply_text || '',
    })
    setEditing(rule)
    setError('')
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!form.monitored_account_id) { setError('Select a monitored account'); return }
    if (!form.x_account_id) { setError('Select an X account'); return }
    if (!form.do_retweet && !form.do_like && !form.do_bookmark && !form.do_reply) { setError('Select at least one action'); return }
    if (form.do_reply && !form.reply_text.trim()) { setError('Reply text cannot be empty'); return }
    if (form.retweet_delay_seconds < 0 || form.like_delay_seconds < 0 || form.bookmark_delay_seconds < 0 || form.reply_delay_seconds < 0) {
      setError('Delays must be 0 or greater'); return
    }

    setSaving(true)
    const payload = {
      user_id: user.id,
      monitored_account_id: form.monitored_account_id,
      x_account_id: form.x_account_id,
      enabled: form.enabled,
      do_retweet: form.do_retweet,
      retweet_delay_seconds: form.retweet_delay_seconds,
      do_like: form.do_like,
      like_delay_seconds: form.like_delay_seconds,
      do_bookmark: form.do_bookmark,
      bookmark_delay_seconds: form.bookmark_delay_seconds,
      do_reply: form.do_reply,
      reply_delay_seconds: form.reply_delay_seconds,
      reply_text: form.do_reply ? form.reply_text.trim() : null,
    }

    if (editing) {
      const { error } = await supabase.from('automation_rules').update(payload).eq('id', editing.id)
      if (error) { setError(error.code === '23505' ? 'This rule already exists' : error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('automation_rules').insert(payload)
      if (error) { setError(error.code === '23505' ? 'This rule already exists' : error.message); setSaving(false); return }
    }

    setSaving(false)
    setShowModal(false)
    resetForm()
    fetchData()
  }

  const handleToggle = async (rule) => {
    await supabase.from('automation_rules').update({ enabled: !rule.enabled }).eq('id', rule.id)
    fetchData()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this automation rule?')) return
    await supabase.from('automation_rules').delete().eq('id', id)
    fetchData()
  }

  const getMonitoredName = (id) => monitoredAccounts.find(a => a.id === id)?.username || 'Unknown'
  const getXAccountName = (id) => xAccounts.find(a => a.id === id)?.username || 'Unknown'

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Automations</h1>
          <p className="text-sm text-neutral-500">Rules that trigger actions on new posts</p>
        </div>
        <button onClick={openCreate} className="btn-primary" disabled={xAccounts.length === 0 || monitoredAccounts.length === 0}>
          <Plus className="w-4 h-4" />
          New Rule
        </button>
      </motion.div>

      {xAccounts.length === 0 || monitoredAccounts.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 mx-auto bg-neutral-800 rounded-2xl flex items-center justify-center mb-4">
            <Zap className="w-8 h-8 text-neutral-500" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Setup required</h3>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            You need at least one connected X account and one monitored account before creating automation rules.
          </p>
        </div>
      ) : rules.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 mx-auto bg-neutral-800 rounded-2xl flex items-center justify-center mb-4">
            <Zap className="w-8 h-8 text-neutral-500" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No automation rules</h3>
          <p className="text-sm text-neutral-500 mb-6 max-w-sm mx-auto">
            Create a rule to automatically retweet, like, bookmark, or reply to new posts from monitored accounts.
          </p>
          <button onClick={openCreate} className="btn-primary mx-auto">
            <Plus className="w-4 h-4" />
            New Rule
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, i) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="card p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-3">
                    <span className={getStatusBadgeClass(rule.enabled ? 'active' : 'paused')}>
                      {rule.enabled ? 'active' : 'paused'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <Eye className="w-4 h-4 text-neutral-500" />
                    <span className="text-neutral-300">Monitoring:</span>
                    <span className="font-medium">@{getMonitoredName(rule.monitored_account_id)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm mb-3">
                    <Bird className="w-4 h-4 text-neutral-500" />
                    <span className="text-neutral-300">Target:</span>
                    <span className="font-medium">@{getXAccountName(rule.x_account_id)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rule.do_retweet && (
                      <span className="badge bg-primary-500/10 text-primary-400 border border-primary-500/20">
                        <Repeat className="w-3 h-3" /> Retweet ({rule.retweet_delay_seconds}s)
                      </span>
                    )}
                    {rule.do_like && (
                      <span className="badge bg-error-500/10 text-error-400 border border-error-500/20">
                        <Heart className="w-3 h-3" /> Like ({rule.like_delay_seconds}s)
                      </span>
                    )}
                    {rule.do_bookmark && (
                      <span className="badge bg-accent-500/10 text-accent-400 border border-accent-500/20">
                        <Bookmark className="w-3 h-3" /> Bookmark ({rule.bookmark_delay_seconds}s)
                      </span>
                    )}
                    {rule.do_reply && (
                      <span className="badge bg-success-500/10 text-success-400 border border-success-500/20">
                        <MessageCircle className="w-3 h-3" /> Reply ({rule.reply_delay_seconds}s)
                      </span>
                    )}
                  </div>
                  {rule.do_reply && rule.reply_text && (
                    <p className="text-xs text-neutral-500 mt-2 italic truncate">"{rule.reply_text}"</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => handleToggle(rule)} className="btn-ghost" title={rule.enabled ? 'Disable' : 'Enable'}>
                    {rule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(rule)} className="btn-ghost" title="Edit">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(rule.id)} className="btn-ghost text-neutral-400 hover:text-error-400" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-black/70"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between p-5 border-b border-neutral-800">
                <h2 className="text-lg font-semibold">{editing ? 'Edit Rule' : 'New Automation Rule'}</h2>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-5">
                {error && (
                  <div className="p-3 bg-error-500/10 border border-error-500/20 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-error-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-error-400">{error}</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1.5">Monitored Account</label>
                  <select
                    value={form.monitored_account_id}
                    onChange={(e) => setForm({ ...form, monitored_account_id: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select an account to watch...</option>
                    {monitoredAccounts.map((a) => (
                      <option key={a.id} value={a.id}>@{a.username} ({a.status})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1.5">X Account (Target)</label>
                  <select
                    value={form.x_account_id}
                    onChange={(e) => setForm({ ...form, x_account_id: e.target.value })}
                    className="input-field"
                  >
                    <option value="">Select your X account...</option>
                    {xAccounts.map((a) => (
                      <option key={a.id} value={a.id}>@{a.username}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-neutral-300">Actions</label>
                  <ActionToggle
                    icon={Repeat} label="Retweet" color="primary"
                    enabled={form.do_retweet}
                    onToggle={(v) => setForm({ ...form, do_retweet: v })}
                    delay={form.retweet_delay_seconds}
                    onDelayChange={(v) => setForm({ ...form, retweet_delay_seconds: v })}
                  />
                  <ActionToggle
                    icon={Heart} label="Like" color="error"
                    enabled={form.do_like}
                    onToggle={(v) => setForm({ ...form, do_like: v })}
                    delay={form.like_delay_seconds}
                    onDelayChange={(v) => setForm({ ...form, like_delay_seconds: v })}
                  />
                  <ActionToggle
                    icon={Bookmark} label="Bookmark" color="accent"
                    enabled={form.do_bookmark}
                    onToggle={(v) => setForm({ ...form, do_bookmark: v })}
                    delay={form.bookmark_delay_seconds}
                    onDelayChange={(v) => setForm({ ...form, bookmark_delay_seconds: v })}
                  />
                  <ActionToggle
                    icon={MessageCircle} label="Reply" color="success"
                    enabled={form.do_reply}
                    onToggle={(v) => setForm({ ...form, do_reply: v })}
                    delay={form.reply_delay_seconds}
                    onDelayChange={(v) => setForm({ ...form, reply_delay_seconds: v })}
                  />
                  {form.do_reply && (
                    <div className="pl-10">
                      <textarea
                        value={form.reply_text}
                        onChange={(e) => setForm({ ...form, reply_text: e.target.value })}
                        className="input-field min-h-[80px] resize-y"
                        placeholder="Reply text (e.g. Great post!)"
                        maxLength={280}
                      />
                      <p className="text-xs text-neutral-500 mt-1">{form.reply_text.length}/280</p>
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-neutral-300">Rule enabled</span>
                </label>
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving} className="btn-primary flex-1">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (editing ? 'Save Changes' : 'Create Rule')}
                  </button>
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ActionToggle({ icon: Icon, label, color, enabled, onToggle, delay, onDelayChange }) {
  const colorClasses = {
    primary: { text: 'text-primary-400', bg: 'bg-primary-600' },
    error: { text: 'text-error-400', bg: 'bg-error-600' },
    success: { text: 'text-success-400', bg: 'bg-success-600' },
    accent: { text: 'text-accent-400', bg: 'bg-accent-600' },
  }
  const c = colorClasses[color] || colorClasses.primary
  return (
    <div className={`p-3 rounded-lg border transition-all ${enabled ? 'bg-neutral-800/60 border-neutral-700' : 'bg-neutral-900 border-neutral-800'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className={`w-4 h-4 ${enabled ? c.text : 'text-neutral-600'}`} />
          <span className={`text-sm font-medium ${enabled ? 'text-neutral-200' : 'text-neutral-500'}`}>{label}</span>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={`relative w-10 h-6 rounded-full transition-colors ${enabled ? c.bg : 'bg-neutral-700'}`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? 'left-5' : 'left-1'}`} />
        </button>
      </div>
      {enabled && (
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-neutral-500">Delay (seconds):</label>
          <input
            type="number"
            min="0"
            value={delay}
            onChange={(e) => onDelayChange(parseInt(e.target.value) || 0)}
            className="w-20 px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      )}
    </div>
  )
}
