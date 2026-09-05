import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Bird,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2
} from 'lucide-react'

import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getStatusBadgeClass } from '../lib/utils'

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://rizcodzzaraogweidnqw.supabase.co'

const OAUTH_REDIRECT_URI =
  import.meta.env.VITE_X_OAUTH_REDIRECT_URI ||
  `${SUPABASE_URL}/functions/v1/oauth-callback`

export default function XAccounts() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [oauthError, setOauthError] = useState('')
  const [oauthSuccess, setOauthSuccess] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [connecting, setConnecting] = useState(false)

  const fetchAccounts = useCallback(async () => {
    if (!user?.id) {
      setAccounts([])
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('x_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[X ACCOUNTS] Failed to fetch accounts:', error)
      setAccounts([])
    } else {
      setAccounts(data || [])
    }

    setLoading(false)
  }, [user])

  useEffect(() => {
    fetchAccounts()

    const err = searchParams.get('oauth_error')
    const success = searchParams.get('oauth_success')

    if (err) {
      setOauthError(err)
    }

    if (success === 'true') {
      setOauthSuccess(true)
    }
  }, [fetchAccounts, searchParams])

  const base64UrlEncode = (bytes) => {
    let binary = ''

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte)
    })

    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }

  const generateRandomString = (length = 64) => {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

    const randomValues = new Uint8Array(length)
    crypto.getRandomValues(randomValues)

    return Array.from(randomValues)
      .map((value) => chars[value % chars.length])
      .join('')
  }

  const generateCodeChallenge = async (verifier) => {
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)

    const digest = await crypto.subtle.digest('SHA-256', data)

    return base64UrlEncode(new Uint8Array(digest))
  }

  const handleConnect = async () => {
    if (!user?.id) {
      setOauthError('You must be logged in to connect an X account.')
      return
    }

    const clientId = import.meta.env.VITE_X_CLIENT_ID

    if (!clientId) {
      setOauthError(
        'X OAuth is not configured. Please set VITE_X_CLIENT_ID in your Netlify environment variables.'
      )
      return
    }

    setConnecting(true)
    setOauthError('')

    try {
      // Generate a secure PKCE verifier.
      const codeVerifier = generateRandomString(96)

      // Generate the corresponding SHA-256 PKCE challenge.
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      // Generate a cryptographically random state.
      const state = crypto.randomUUID()

      console.log('[OAUTH] Starting OAuth flow')
      console.log('[OAUTH] Redirect URI:', OAUTH_REDIRECT_URI)

      // Store state + verifier server-side.
      const { error: stateError } = await supabase
        .from('x_oauth_states')
        .insert({
          user_id: user.id,
          state,
          code_verifier: codeVerifier,
          redirect_uri: OAUTH_REDIRECT_URI,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        })

      if (stateError) {
        console.error('[OAUTH] Failed to store OAuth state:', stateError)

        throw new Error(
          'Impossible de préparer la connexion OAuth. Vérifie la table x_oauth_states.'
        )
      }

      const authUrl = new URL(
        'https://x.com/i/oauth2/authorize'
      )

      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('state', state)

      authUrl.searchParams.set(
        'scope',
        'tweet.read tweet.write users.read like.write bookmark.write offline.access'
      )

      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')

      console.log('[OAUTH] Redirecting to X')

      window.location.assign(authUrl.toString())
    } catch (error) {
      console.error('[OAUTH] Start failed:', error)

      setOauthError(
        error?.message || 'Unable to start X OAuth connection.'
      )

      setConnecting(false)
    }
  }

  const handleDelete = async (id) => {
    if (
      !confirm(
        'Remove this X account? All related automations will be deleted.'
      )
    ) {
      return
    }

    setDeleting(id)

    const { error } = await supabase
      .from('x_accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('[X ACCOUNTS] Delete failed:', error)
      setOauthError('Failed to remove X account.')
    } else {
      await fetchAccounts()
    }

    setDeleting(null)
  }

  const handleReconnect = () => {
    handleConnect()
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between mb-8"
      >
        <div>
          <h1 className="text-2xl font-bold mb-1">
            X Accounts
          </h1>

          <p className="text-sm text-neutral-500">
            Connect and manage your X accounts for automation
          </p>
        </div>

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="btn-primary"
        >
          {connecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}

          {connecting ? 'Connecting...' : 'Connect X Account'}
        </button>
      </motion.div>

      {oauthError && (
        <div className="mb-6 p-4 bg-error-500/10 border border-error-500/20 rounded-lg flex items-start gap-3 animate-fade-in">
          <AlertCircle className="w-5 h-5 text-error-400 flex-shrink-0 mt-0.5" />

          <div className="flex-1">
            <p className="text-sm text-error-400 font-medium">
              Connection failed
            </p>

            <p className="text-sm text-error-400/80 mt-0.5">
              {oauthError}
            </p>
          </div>

          <button
            onClick={() => setOauthError('')}
            className="text-error-400/60 hover:text-error-400"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}

      {oauthSuccess && (
        <div className="mb-6 p-4 bg-success-500/10 border border-success-500/20 rounded-lg flex items-start gap-3 animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-success-400 flex-shrink-0 mt-0.5" />

          <div className="flex-1">
            <p className="text-sm text-success-400 font-medium">
              X account connected successfully
            </p>

            <p className="text-sm text-success-400/80 mt-0.5">
              Your account is now active and ready for automation.
            </p>
          </div>

          <button
            onClick={() => setOauthSuccess(false)}
            className="text-success-400/60 hover:text-success-400"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 mx-auto bg-neutral-800 rounded-2xl flex items-center justify-center mb-4">
            <Bird className="w-8 h-8 text-neutral-500" />
          </div>

          <h3 className="text-lg font-semibold mb-1">
            No X accounts connected
          </h3>

          <p className="text-sm text-neutral-500 mb-6 max-w-sm mx-auto">
            Connect your first X account to start automating retweets, likes,
            and replies.
          </p>

          <button
            onClick={handleConnect}
            disabled={connecting}
            className="btn-primary mx-auto"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}

            {connecting ? 'Connecting...' : 'Connect X Account'}
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
                <div className="w-12 h-12 rounded-full bg-neutral-800 overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {account.profile_image_url ? (
                    <img
                      src={account.profile_image_url}
                      alt={account.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Bird className="w-6 h-6 text-neutral-500" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">
                      {account.display_name || account.username}
                    </h3>

                    <span
                      className={getStatusBadgeClass(account.status)}
                    >
                      {account.status}
                    </span>
                  </div>

                  <p className="text-sm text-neutral-500">
                    @{account.username}
                  </p>

                  {account.last_error && (
                    <p className="text-xs text-error-400 mt-1 truncate">
                      {account.last_error}
                    </p>
                  )}
                </div>

                <div className="hidden sm:flex items-center gap-6 text-center">
                  <div>
                    <p className="text-lg font-bold">
                      {account.retweets_today}
                    </p>
                    <p className="text-xs text-neutral-500">
                      RTs today
                    </p>
                  </div>

                  <div>
                    <p className="text-lg font-bold">
                      {account.likes_today}
                    </p>
                    <p className="text-xs text-neutral-500">
                      Likes today
                    </p>
                  </div>

                  <div>
                    <p className="text-lg font-bold">
                      {account.bookmarks_today}
                    </p>
                    <p className="text-xs text-neutral-500">
                      Saves today
                    </p>
                  </div>

                  <div>
                    <p className="text-lg font-bold">
                      {account.replies_today}
                    </p>
                    <p className="text-xs text-neutral-500">
                      Replies today
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {account.status === 'error' && (
                    <button
                      onClick={handleReconnect}
                      className="btn-ghost"
                      title="Reconnect"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(account.id)}
                    disabled={deleting === account.id}
                    className="btn-ghost text-neutral-400 hover:text-error-400"
                    title="Remove"
                  >
                    {deleting === account.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="sm:hidden grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-neutral-800 text-center">
                <div>
                  <p className="text-base font-bold">
                    {account.retweets_today}
                  </p>
                  <p className="text-xs text-neutral-500">RTs</p>
                </div>

                <div>
                  <p className="text-base font-bold">
                    {account.likes_today}
                  </p>
                  <p className="text-xs text-neutral-500">Likes</p>
                </div>

                <div>
                  <p className="text-base font-bold">
                    {account.bookmarks_today}
                  </p>
                  <p className="text-xs text-neutral-500">Saves</p>
                </div>

                <div>
                  <p className="text-base font-bold">
                    {account.replies_today}
                  </p>
                  <p className="text-xs text-neutral-500">Replies</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-neutral-900/50 border border-neutral-800 rounded-lg">
        <p className="text-xs text-neutral-500 leading-relaxed">
          <strong className="text-neutral-400">Note:</strong>{' '}
          Connecting an X account requires OAuth 2.0 credentials from the X
          Developer Portal.
        </p>

        <p className="text-xs text-neutral-500 leading-relaxed mt-2">
          The callback is handled securely by the Supabase Edge Function.
        </p>

        <Link
          to="/settings"
          className="text-primary-400 hover:text-primary-300 text-xs"
        >
          Settings
        </Link>
      </div>
    </div>
  )
}

