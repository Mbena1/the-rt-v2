import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Settings as SettingsIcon, Save, Loader2, CheckCircle2, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Settings() {
  const { user } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from('automation_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
    setSettings(data)
    setLoading(false)
  }, [user])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const handleChange = (field, value) => {
    setSettings({ ...settings, [field]: value })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    await supabase
      .from('automation_settings')
      .update({
        enabled: settings.enabled,
        monitoring_enabled: settings.monitoring_enabled,
        max_daily_retweets: settings.max_daily_retweets,
        max_daily_likes: settings.max_daily_likes,
        max_daily_bookmarks: settings.max_daily_bookmarks,
        max_daily_replies: settings.max_daily_replies,
        default_delay_seconds: settings.default_delay_seconds,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-sm text-neutral-500">Configure your automation preferences</p>
      </motion.div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Master toggles */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Automation Controls</h2>
          <div className="space-y-4">
            <ToggleRow
              label="Enable Automation"
              description="Master switch for all automation actions"
              checked={settings.enabled}
              onChange={(v) => handleChange('enabled', v)}
            />
            <ToggleRow
              label="Enable Monitoring"
              description="Watch monitored accounts for new posts"
              checked={settings.monitoring_enabled}
              onChange={(v) => handleChange('monitoring_enabled', v)}
            />
          </div>
        </div>

        {/* Daily limits */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Daily Limits</h2>
          <p className="text-sm text-neutral-500 mb-4">Maximum actions per day, per X account. Each account has its own counter.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumberInput
              label="Max Retweets"
              value={settings.max_daily_retweets}
              onChange={(v) => handleChange('max_daily_retweets', v)}
            />
            <NumberInput
              label="Max Likes"
              value={settings.max_daily_likes}
              onChange={(v) => handleChange('max_daily_likes', v)}
            />
            <NumberInput
              label="Max Bookmarks"
              value={settings.max_daily_bookmarks}
              onChange={(v) => handleChange('max_daily_bookmarks', v)}
            />
            <NumberInput
              label="Max Replies"
              value={settings.max_daily_replies}
              onChange={(v) => handleChange('max_daily_replies', v)}
            />
          </div>
        </div>

        {/* Default delay */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-4">Default Delay</h2>
          <NumberInput
            label="Default Delay (seconds)"
            value={settings.default_delay_seconds}
            onChange={(v) => handleChange('default_delay_seconds', v)}
          />
          <p className="text-xs text-neutral-500 mt-2">Used as the default delay when creating new automation rules.</p>
        </div>

        {/* X API configuration info */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Info className="w-5 h-5 text-accent-400" />
            <h2 className="text-lg font-semibold">X API Configuration</h2>
          </div>
          <p className="text-sm text-neutral-500 mb-4">
            The following secrets must be configured in your Supabase project for X automation to work.
            These are set in the Supabase dashboard under Edge Functions secrets.
          </p>
          <div className="space-y-2">
            {[
              { key: 'X_CLIENT_ID', desc: 'OAuth 2.0 client ID from X Developer Portal' },
              { key: 'X_CLIENT_SECRET', desc: 'OAuth 2.0 client secret from X Developer Portal' },
              { key: 'X_BEARER_TOKEN', desc: 'App-only bearer token for monitoring tweets' },
              { key: 'X_OAUTH_REDIRECT_URI', desc: 'OAuth callback URL (your edge function URL)' },
              { key: 'FRONTEND_URL', desc: 'Your app URL for OAuth redirects' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between p-3 bg-neutral-800/40 rounded-lg">
                <div>
                  <code className="text-sm text-neutral-300 font-mono">{item.key}</code>
                  <p className="text-xs text-neutral-500 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center gap-4">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Settings
          </button>
          {saved && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-success-400"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm">Settings saved</span>
            </motion.div>
          )}
        </div>
      </form>
    </div>
  )
}

function ToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-neutral-200">{label}</p>
        <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-primary-600' : 'bg-neutral-700'}`}
      >
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  )
}

function NumberInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-300 mb-1.5">{label}</label>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="input-field"
      />
    </div>
  )
}
