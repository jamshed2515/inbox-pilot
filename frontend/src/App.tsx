import { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  Calendar,
  Clock,
  Send,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Layers,
  Search,
  Trash2,
  RotateCcw,
  PlusCircle,
  Sparkles,
  Zap,
  Eye,
  X,
  Users,
  Check,
  Radio,
  MessageSquare,
  ShieldAlert,
  Bell,
  Hash,
  LogOut,
  Upload,
  List,
  Grid,
  Lock,
  ShieldCheck,
} from 'lucide-react';

export interface UserProfile {
  id: string;
  google_id?: string | null;
  email: string;
  name: string;
  avatar_url?: string | null;
  created_at?: string;
}

export interface EmailSenderRecord {
  id: string;
  name: string;
  email: string;
  is_default: boolean;
}

export interface SlackStatusData {
  connected: boolean;
  data: {
    teamName?: string;
    channel?: string;
    hasWebhook?: boolean;
    hasToken?: boolean;
    updatedAt?: string;
  } | null;
  oauthUrl: string;
}

interface EmailRecord {
  id: string;
  job_id: string;
  sender_id?: string | null;
  recipient: string;
  subject: string;
  body: string;
  status: 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';
  scheduled_at: string;
  sent_at: string | null;
  error_message: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

interface StatsData {
  database: {
    total: number;
    scheduled: number;
    processing: number;
    sent: number;
    failed: number;
    cancelled: number;
  };
  queue: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    total: number;
  };
  mailer: {
    type: string;
    user: string;
  };
  storageType: string;
}

const EMAIL_TEMPLATES = [
  {
    name: '🎉 Welcome Onboarding',
    subject: 'Welcome to ReachInbox AI Platform!',
    body: `<h2>Welcome aboard!</h2>
<p>Hi there,</p>
<p>Thank you for testing the <strong>ReachInbox Email Job Scheduler</strong>.</p>
<p>Your scheduled task was processed successfully by our high-performance <strong>BullMQ + Redis</strong> worker pipeline.</p>
<hr />
<p style="color: #64748b; font-size: 13px;">ReachInbox Automated Delivery System</p>`,
  },
  {
    name: '📊 Weekly Performance Report',
    subject: 'Your Weekly Outbound Email Campaign Analytics',
    body: `<h3>Outbound Campaign Performance</h3>
<p>Here is your campaign delivery breakdown for this cycle:</p>
<ul>
  <li><strong>Delivery Success Rate:</strong> 99.8%</li>
  <li><strong>Average Queue Latency:</strong> 124ms</li>
  <li><strong>Worker Concurrency:</strong> 5 concurrent threads</li>
</ul>
<p>Keep up the great outreach momentum!</p>`,
  },
  {
    name: '⚡ Product Launch Invitation',
    subject: 'Exclusive VIP Access: Next-Gen Cold Email Automation',
    body: `<h2>You are invited to the Private Beta!</h2>
<p>We are unveiling our next-generation email sequencer with native BullMQ queue persistence, AI sentiment categorization, and real-time delivery insights.</p>
<p>Check out your sandbox preview below.</p>`,
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'queue' | 'history' | 'composer' | 'batch' | 'slack'>('queue');
  const [scheduledEmails, setScheduledEmails] = useState<EmailRecord[]>([]);
  const [emailHistory, setEmailHistory] = useState<EmailRecord[]>([]);
  const [senders, setSenders] = useState<EmailSenderRecord[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [batchSenderId, setBatchSenderId] = useState<string>('');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const [nowTime, setNowTime] = useState<number>(Date.now());

  // Slack Integration State
  const [slackStatus, setSlackStatus] = useState<SlackStatusData | null>(null);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState<string>('');
  const [slackConnecting, setSlackConnecting] = useState<boolean>(false);
  const [slackTesting, setSlackTesting] = useState<boolean>(false);

  // Composer Form State
  const [recipient, setRecipient] = useState<string>('alex.founder@reachinbox.ai');
  const [subject, setSubject] = useState<string>('Welcome to ReachInbox Scheduler!');
  const [body, setBody] = useState<string>(EMAIL_TEMPLATES[0].body);
  const [scheduleType, setScheduleType] = useState<'delay' | 'datetime'>('delay');
  const [delaySeconds, setDelaySeconds] = useState<number>(15);
  const [scheduledAt, setScheduledAt] = useState<string>('');
  const [staggerSeconds, setStaggerSeconds] = useState<number>(2);
  const [queueViewMode, setQueueViewMode] = useState<'table' | 'cards'>('table');
  const [composerSubmitting, setComposerSubmitting] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // CSV / TXT Recipient File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      const uniqueEmails = Array.from(new Set(emailMatches.map((em) => em.trim().toLowerCase())));

      if (uniqueEmails.length === 0) {
        showNotification('No valid email addresses found in file', 'error');
        return;
      }

      setRecipient(uniqueEmails.join('\n'));
      showNotification(`📄 Loaded ${uniqueEmails.length} recipients from ${file.name}!`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Helper to resolve sender label
  const getSenderLabel = (senderId?: string | null) => {
    if (!senderId) return 'Default Outreach Team';
    const s = senders.find((snd) => snd.id === senderId);
    return s ? `${s.name} <${s.email}>` : 'Default Outreach Team';
  };

  // Batch Form State
  const [batchRecipients, setBatchRecipients] = useState<string>(
    'sarah.cto@acme.com\njohn.doe@innovate.co\nemily.v@growthlab.io'
  );
  const [batchSubject, setBatchSubject] = useState<string>('Exclusive Invitation: ReachInbox Developer Beta');
  const [batchBody, setBatchBody] = useState<string>(
    '<p>Hi there,</p><p>We are pleased to invite you to our high-scale queue testing pilot.</p>'
  );
  const [batchStagger, setBatchStagger] = useState<number>(3);
  const [batchBaseDelay, setBatchBaseDelay] = useState<number>(10);
  const [batchSubmitting, setBatchSubmitting] = useState<boolean>(false);

  // Modal Email Preview
  const [previewEmail, setPreviewEmail] = useState<EmailRecord | null>(null);

  // Auth State (Phase F - Google OAuth)
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem('reachinbox_token') || '');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [googleOauthConfigured, setGoogleOauthConfigured] = useState<boolean | null>(null);

  // Check whether Google OAuth credentials are configured on the backend
  useEffect(() => {
    fetch('/api/auth/google/url')
      .then((res) => res.json())
      .then((data) => {
        setGoogleOauthConfigured(Boolean(data.hasCredentials));
      })
      .catch(() => {
        setGoogleOauthConfigured(false);
      });
  }, []);

  // Update current time tick for live countdowns
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for Google and Slack OAuth redirect parameters in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const authError = params.get('auth_error');

    if (urlToken) {
      localStorage.setItem('reachinbox_token', urlToken);
      setAuthToken(urlToken);
      window.history.replaceState({}, document.title, window.location.pathname);
      showNotification('🎉 Signed in with Google successfully!');
    } else if (authError) {
      showNotification(`Authentication error: ${authError}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (params.get('slack') === 'connected') {
      showNotification('🎉 Slack workspace connected successfully via OAuth!');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('slack_error')) {
      showNotification(`Slack connection error: ${params.get('slack_error')}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Fetch current user from /api/auth/me
  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null);
      setAuthLoading(false);
      return;
    }

    setAuthLoading(true);
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => {
        if (data.data?.user) {
          setCurrentUser(data.data.user);
        } else {
          localStorage.removeItem('reachinbox_token');
          setAuthToken('');
          setCurrentUser(null);
        }
      })
      .catch(() => {
        localStorage.removeItem('reachinbox_token');
        setAuthToken('');
        setCurrentUser(null);
      })
      .finally(() => {
        setAuthLoading(false);
      });
  }, [authToken]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    localStorage.removeItem('reachinbox_token');
    setAuthToken('');
    setCurrentUser(null);
    setStats(null);
    setScheduledEmails([]);
    setEmailHistory([]);
    setSenders([]);
    setSlackStatus(null);
    setPreviewEmail(null);
    showNotification('Logged out successfully.');
  };

  const handleDemoGoogleLogin = async () => {
    try {
      const res = await fetch('/api/auth/mock-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alex.founder@reachinbox.ai',
          name: 'Alex Founder',
          avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Login failed');
      localStorage.setItem('reachinbox_token', data.data.token);
      setAuthToken(data.data.token);
      setCurrentUser(data.data.user);
      showNotification(`Welcome back, ${data.data.user.name}!`);
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  const showNotification = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMessage({ text, type });
    setTimeout(() => {
      setActionMessage((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Centralized Authenticated Fetch Helper
  const authFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers || {});
      const token = authToken || localStorage.getItem('reachinbox_token');
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const res = await fetch(input, {
        ...init,
        headers,
      });

      if (res.status === 401) {
        localStorage.removeItem('reachinbox_token');
        setAuthToken('');
        setCurrentUser(null);
        setStats(null);
        setScheduledEmails([]);
        setEmailHistory([]);
        setSenders([]);
        setSlackStatus(null);
        setPreviewEmail(null);
        showNotification('Session expired or unauthorized. Please sign in again.', 'error');
      }

      return res;
    },
    [authToken]
  );

  // Fetch all data (Authenticated Only)
  const fetchData = useCallback(async () => {
    const token = authToken || localStorage.getItem('reachinbox_token');
    if (!token) return;

    try {
      const [statsRes, schedRes, histRes, sendersRes, slackRes] = await Promise.all([
        authFetch('/api/emails/stats'),
        authFetch('/api/emails/scheduled'),
        authFetch(`/api/emails/history?status=${historyFilter}`),
        authFetch('/api/senders'),
        authFetch('/api/slack/status'),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
        setBackendOnline(true);
      } else {
        setBackendOnline(false);
      }

      if (schedRes.ok) {
        const data = await schedRes.json();
        setScheduledEmails(data.data || []);
      }

      if (histRes.ok) {
        const data = await histRes.json();
        setEmailHistory(data.data || []);
      }

      if (sendersRes.ok) {
        const data = await sendersRes.json();
        const sendersList: EmailSenderRecord[] = data.data || [];
        setSenders(sendersList);
        if (sendersList.length > 0 && !selectedSenderId) {
          const defaultSender = sendersList.find((s) => s.is_default) || sendersList[0];
          setSelectedSenderId(defaultSender.id);
          setBatchSenderId(defaultSender.id);
        }
      }

      if (slackRes.ok) {
        const data = await slackRes.json();
        setSlackStatus(data);
      }
    } catch {
      setBackendOnline(false);
    }
  }, [authFetch, historyFilter, selectedSenderId, authToken]);

  // Fetch data only after user is confirmed authenticated
  useEffect(() => {
    if (currentUser && authToken) {
      fetchData();
    }
  }, [currentUser, authToken, fetchData]);

  // Auto-polling effect (every 3.5 seconds) - only when authenticated
  useEffect(() => {
    if (!autoRefresh || !currentUser || !authToken) return;
    const interval = setInterval(() => {
      fetchData();
    }, 3500);
    return () => clearInterval(interval);
  }, [autoRefresh, currentUser, authToken, fetchData]);

  // Slack Action Handlers
  const handleConnectSlackWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slackWebhookUrl.trim()) return;
    setSlackConnecting(true);
    try {
      const res = await authFetch('/api/slack/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: slackWebhookUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to connect Slack webhook');
      showNotification('🎉 Slack webhook connected and saved to PostgreSQL!');
      setSlackWebhookUrl('');
      fetchData();
    } catch (err: any) {
      showNotification(err.message, 'error');
    } finally {
      setSlackConnecting(false);
    }
  };

  const handleTestSlackAlert = async () => {
    setSlackTesting(true);
    try {
      const res = await authFetch('/api/slack/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to send alert');
      showNotification('✅ Real Slack rate-limit alert dispatched to channel!');
    } catch (err: any) {
      showNotification(err.message, 'error');
    } finally {
      setSlackTesting(false);
    }
  };

  const handleDisconnectSlack = async () => {
    try {
      const res = await authFetch('/api/slack/disconnect', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to disconnect');
      showNotification('Slack integration disconnected');
      fetchData();
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Schedule Email (Single or Batch with Staggering)
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setComposerSubmitting(true);

    const emailList = recipient
      .split(/[\n,;]+/)
      .map((em) => em.trim())
      .filter((em) => em.length > 0 && em.includes('@'));

    if (emailList.length === 0) {
      showNotification('Please enter at least one valid recipient email address', 'error');
      setComposerSubmitting(false);
      return;
    }

    try {
      if (emailList.length === 1) {
        // Single Email Scheduling
        const payload: any = {
          recipient: emailList[0],
          subject,
          body,
        };

        if (selectedSenderId) {
          payload.senderId = selectedSenderId;
        }

        if (scheduleType === 'delay') {
          payload.delaySeconds = Number(delaySeconds);
        } else if (scheduledAt) {
          payload.scheduledAt = new Date(scheduledAt).toISOString();
        }

        const res = await authFetch('/api/emails/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Scheduling failed');

        showNotification(data.message || 'Email scheduled successfully!');
      } else {
        // Multiple / CSV Batch Scheduling
        const payload = {
          senderId: selectedSenderId || undefined,
          emails: emailList.map((addr) => ({
            recipient: addr,
            subject,
            body,
            senderId: selectedSenderId || undefined,
            delaySeconds: scheduleType === 'delay' ? Number(delaySeconds) : undefined,
            scheduledAt: scheduleType === 'datetime' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          })),
          staggerSeconds: Number(staggerSeconds || 2),
        };

        const res = await authFetch('/api/emails/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Batch scheduling failed');

        showNotification(`🎉 Scheduled batch of ${emailList.length} emails with ${staggerSeconds}s stagger!`);
      }

      fetchData();
      setActiveTab('queue');
    } catch (err: any) {
      showNotification(err.message, 'error');
    } finally {
      setComposerSubmitting(false);
    }
  };

  // Batch Schedule Submit
  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchSubmitting(true);

    const emailList = batchRecipients
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes('@'));

    if (emailList.length === 0) {
      showNotification('Please enter at least one valid email address', 'error');
      setBatchSubmitting(false);
      return;
    }

    try {
      const payload = {
        senderId: batchSenderId || undefined,
        emails: emailList.map((addr) => ({
          recipient: addr,
          subject: batchSubject,
          body: batchBody,
          senderId: batchSenderId || undefined,
          delaySeconds: Number(batchBaseDelay),
        })),
        staggerSeconds: Number(batchStagger),
      };

      const res = await authFetch('/api/emails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Batch scheduling failed');

      showNotification(`Batch of ${emailList.length} emails scheduled successfully!`);
      fetchData();
      setActiveTab('queue');
    } catch (err: any) {
      showNotification(err.message, 'error');
    } finally {
      setBatchSubmitting(false);
    }
  };

  // Cancel Scheduled Email
  const handleCancelEmail = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this scheduled email?')) return;
    try {
      const res = await authFetch(`/api/emails/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to cancel');
      showNotification('Scheduled email cancelled.');
      fetchData();
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Retry Failed Email
  const handleRetryEmail = async (id: string) => {
    try {
      const res = await authFetch(`/api/emails/${id}/retry`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Retry failed');
      showNotification('Email re-queued for immediate delivery!');
      fetchData();
    } catch (err: any) {
      showNotification(err.message, 'error');
    }
  };

  // Filtered lists
  const filteredScheduled = scheduledEmails.filter((item) => {
    const q = searchQuery.toLowerCase();
    return (
      item.recipient.toLowerCase().includes(q) ||
      item.subject.toLowerCase().includes(q)
    );
  });

  const filteredHistory = emailHistory.filter((item) => {
    const q = searchQuery.toLowerCase();
    return (
      item.recipient.toLowerCase().includes(q) ||
      item.subject.toLowerCase().includes(q)
    );
  });

  // Calculate countdown time string
  const formatCountdown = (scheduledIso: string) => {
    const diffMs = new Date(scheduledIso).getTime() - nowTime;
    if (diffMs <= 0) return 'Sending now...';
    const totalSecs = Math.floor(diffMs / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins === 0) return `in ${secs}s`;
    return `in ${mins}m ${secs}s`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-teal-500/30">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-teal-400 to-indigo-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Mail className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-white tracking-tight text-lg">ReachInbox</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20">
                  Email Job Scheduler
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {!currentUser ? (
              <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-400">
                <Lock className="w-3.5 h-3.5 text-teal-400" />
                <span className="hidden sm:inline">Authentication Required</span>
                <span className="sm:hidden">Sign In</span>
              </div>
            ) : (
              <>
                {/* Auto Refresh Toggle */}
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                    autoRefresh
                      ? 'bg-teal-950/60 text-teal-300 border-teal-800/80'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                  title="Toggle Live 3s Polling"
                >
                  <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'text-teal-400 animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">{autoRefresh ? 'Live Sync ON' : 'Live Sync OFF'}</span>
                </button>

                {/* Slack Connect Button */}
                <button
                  onClick={() => setActiveTab('slack')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    slackStatus?.connected
                      ? 'bg-purple-950/60 text-purple-300 border-purple-800 hover:bg-purple-900/60'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                  title="Slack OAuth & Rate Limit Alerting"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                  <span className="hidden md:inline">
                    {slackStatus?.connected ? `Slack: ${slackStatus.data?.channel || 'Active'}` : 'Connect Slack'}
                  </span>
                  {slackStatus?.connected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  )}
                </button>

                {/* BullMQ Dashboard Launcher (Phase G) */}
                <a
                  href="http://localhost:5000/admin/queues"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition shadow-sm"
                  title="Open Bull Board Queue Dashboard"
                >
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Bull Board</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>

                {/* Manual Refresh Button */}
                <button
                  onClick={() => {
                    setLoading(true);
                    fetchData().finally(() => setLoading(false));
                  }}
                  disabled={loading}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
                  title="Refresh Data"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-teal-400' : ''}`} />
                </button>

                {/* Status Indicator */}
                <div className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      backendOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                    }`}
                  ></span>
                  <span className="text-slate-300">{backendOnline ? 'BullMQ Active' : 'Offline'}</span>
                </div>

                {/* User Profile & Logout (Phase F - Google OAuth) */}
                <div className="flex items-center space-x-2 pl-3 border-l border-slate-800">
                  <div className="flex items-center gap-2">
                    {currentUser.avatar_url ? (
                      <img
                        src={currentUser.avatar_url}
                        alt={currentUser.name}
                        className="w-8 h-8 rounded-full border border-teal-500/40 object-cover shadow-sm"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-teal-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-slate-950">
                        {currentUser.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="hidden xl:block text-left">
                      <div className="text-xs font-bold text-white truncate max-w-[130px] leading-tight">
                        {currentUser.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono truncate max-w-[130px] leading-tight">
                        {currentUser.email}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 hover:text-white border border-rose-800/40 text-xs font-medium transition cursor-pointer"
                    title="Logout from session"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Logout</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Floating Alert Notification */}
      {actionMessage && (
        <div className="fixed top-20 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-200">
          <div
            className={`rounded-xl border px-4 py-3 shadow-2xl flex items-center space-x-3 backdrop-blur-md ${
              actionMessage.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
                : 'bg-rose-950/90 border-rose-700 text-rose-200'
            }`}
          >
            {actionMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <span className="text-xs font-medium">{actionMessage.text}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-slate-400 hover:text-white ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {authLoading ? (
          /* Loading Splash: Verifying Session */
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-5 animate-in fade-in duration-200">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-400 to-indigo-500 flex items-center justify-center shadow-xl shadow-teal-500/20">
                <Mail className="w-8 h-8 text-slate-950 animate-pulse" />
              </div>
              <div className="absolute -inset-1.5 rounded-2xl bg-teal-500/20 blur-md animate-ping"></div>
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-base font-bold text-white tracking-wide">Verifying ReachInbox Session</h3>
              <p className="text-xs text-slate-400 font-mono">Validating JWT authentication state with PostgreSQL...</p>
            </div>
          </div>
        ) : !currentUser ? (
          /* ONLY LOGIN SCREEN - No dashboard underneath! */
          <div className="max-w-xl mx-auto my-12 p-8 sm:p-10 rounded-3xl border border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur-2xl text-center space-y-7 animate-in zoom-in-95 duration-200">
            <div className="w-18 h-18 rounded-3xl bg-gradient-to-tr from-teal-400 via-teal-300 to-indigo-500 flex items-center justify-center mx-auto shadow-2xl shadow-teal-500/25 p-4">
              <Mail className="w-10 h-10 text-slate-950" />
            </div>

            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20 text-[11px] font-mono font-bold uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
                <span>Protected Enterprise Access</span>
              </div>
              <h2 className="text-3xl font-black text-white tracking-tight">ReachInbox Scheduler</h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                Sign in to access your email queues, dynamic sender pools, rate limiting, and PostgreSQL persistence dashboard.
              </p>
            </div>

            <div className="pt-2 space-y-3.5">
              {/* Prominent Primary: One-Click Demo Google Login */}
              <button
                onClick={handleDemoGoogleLogin}
                className="w-full py-4 px-5 rounded-2xl bg-gradient-to-r from-teal-400 via-teal-500 to-indigo-600 hover:from-teal-300 hover:to-indigo-500 text-slate-950 font-black text-sm shadow-xl shadow-teal-500/25 flex items-center justify-center gap-2.5 transition transform hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
              >
                <Sparkles className="w-5 h-5 text-slate-950 fill-slate-950" />
                <span>One-Click Demo Google Login</span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-black/20 text-slate-950 font-bold ml-1">
                  Instant Access
                </span>
              </button>

              {/* Secondary: Real Google OAuth (Disabled / Config-Aware) */}
              {googleOauthConfigured ? (
                <a
                  href="/api/auth/google/login"
                  className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-lg flex items-center justify-center gap-2.5 transition cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Real Google OAuth</span>
                </a>
              ) : (
                <div className="space-y-2">
                  <button
                    disabled
                    className="w-full py-3 px-4 rounded-xl bg-slate-800/50 border border-slate-700/60 text-slate-400 font-semibold text-xs flex items-center justify-center gap-2.5 cursor-not-allowed opacity-70"
                    title="Real Google OAuth requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env"
                  >
                    <svg className="w-4 h-4 opacity-40" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google OAuth (Config Required)</span>
                  </button>
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left text-xs text-amber-300 space-y-1">
                    <p className="text-[11px] text-amber-300/90 leading-relaxed">
                      <span className="font-semibold text-amber-200">ℹ️ Note on Real Google OAuth:</span> To test with your own Google Cloud project, add <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-amber-200">GOOGLE_CLIENT_ID</code> and <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-amber-200">GOOGLE_CLIENT_SECRET</code> to <code className="font-mono text-amber-200">backend/.env</code>.
                    </p>
                    <p className="text-[11px] text-teal-300 font-medium">
                      👉 For instant evaluation, use <strong>"One-Click Demo Google Login"</strong> above!
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-[10px] text-slate-500 font-mono">
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">PostgreSQL DB</div>
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">JWT Signed Session</div>
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">BullMQ Protected</div>
            </div>
          </div>
        ) : (
          /* AUTHENTICATED USER DASHBOARD */
          <>
            {/* Live Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Scheduled in Queue */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-4 relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 p-3 opacity-10 text-amber-400 pointer-events-none">
              <Clock className="w-16 h-16" />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
              <span>Scheduled Queue</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-black text-amber-300 font-mono">
              {stats?.database.scheduled ?? scheduledEmails.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Pending Delayed Jobs</div>
          </div>

          {/* Delivered Successfully */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-4 relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 p-3 opacity-10 text-emerald-400 pointer-events-none">
              <CheckCircle2 className="w-16 h-16" />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
              <span>Delivered</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-black text-emerald-400 font-mono">
              {stats?.database.sent ?? 0}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Sent via Nodemailer</div>
          </div>

          {/* Failed / Retrying */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-4 relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 p-3 opacity-10 text-rose-400 pointer-events-none">
              <XCircle className="w-16 h-16" />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
              <span>Failed</span>
              <XCircle className="w-4 h-4 text-rose-400" />
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-black text-rose-400 font-mono">
              {stats?.database.failed ?? 0}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Retry backoff enabled</div>
          </div>

          {/* Total Jobs */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/40 p-4 relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 p-3 opacity-10 text-cyan-400 pointer-events-none">
              <Layers className="w-16 h-16" />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
              <span>Total Processed</span>
              <Layers className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="mt-2 text-2xl sm:text-3xl font-black text-cyan-300 font-mono">
              {stats?.database.total ?? 0}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 truncate">
              {stats?.storageType || 'PostgreSQL'}
            </div>
          </div>

          {/* Ethereal Sandbox */}
          <div className="col-span-2 lg:col-span-1 rounded-2xl border border-teal-900/40 bg-gradient-to-br from-slate-900/80 to-teal-950/20 p-4">
            <div className="flex items-center justify-between text-xs text-teal-400 font-medium">
              <span>SMTP Sandbox</span>
              <Sparkles className="w-4 h-4 text-teal-400" />
            </div>
            <div className="mt-2 text-sm font-semibold text-white truncate">
              Ethereal Test Mail
            </div>
            <div className="text-[11px] text-slate-400 mt-1 truncate font-mono">
              {stats?.mailer.user || 'Auto-Provisioned'}
            </div>
          </div>
        </div>

        {/* Tab Navigation & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('queue')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'queue'
                  ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              Scheduled Queue
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  activeTab === 'queue'
                    ? 'bg-teal-900/60 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {scheduledEmails.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'history'
                  ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Delivery History
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  activeTab === 'history'
                    ? 'bg-teal-900/60 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {emailHistory.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('composer')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'composer'
                  ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              Schedule Email
            </button>

            <button
              onClick={() => setActiveTab('batch')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'batch'
                  ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Batch Campaign
            </button>

            <button
              onClick={() => setActiveTab('slack')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === 'slack'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
              Slack Alerts
              {slackStatus?.connected ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              ) : (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-950/80 text-purple-300 font-mono border border-purple-800/50">
                  OAuth
                </span>
              )}
            </button>
          </div>

          {/* Search bar */}
          {(activeTab === 'queue' || activeTab === 'history') && (
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search recipient or subject..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* TAB 1: SCHEDULED QUEUE */}
        {activeTab === 'queue' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  BullMQ Delayed Job Queue
                </h3>
                <p className="text-xs text-slate-400">
                  These jobs are persisted in Redis and scheduled to be dispatched at their exact specified timestamp.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* View Switcher: Table vs Cards */}
                <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-lg p-0.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setQueueViewMode('table')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition ${
                      queueViewMode === 'table'
                        ? 'bg-teal-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Table View"
                  >
                    <List className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Table</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setQueueViewMode('cards')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition ${
                      queueViewMode === 'cards'
                        ? 'bg-teal-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title="Cards Grid View"
                  >
                    <Grid className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Cards</span>
                  </button>
                </div>

                <a
                  href="http://localhost:5000/admin/queues"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold text-xs transition"
                >
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden md:inline">Open</span> Bull Board
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>

                <button
                  onClick={() => setActiveTab('composer')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-xs shadow-md shadow-teal-500/20 transition"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Schedule New
                </button>
              </div>
            </div>

            {/* Bull Board Real-Time Queue Visualizer (Phase G) */}
            <div className="rounded-2xl border border-amber-500/20 bg-amber-950/10 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-amber-200">
                      Bull Board Active on <code>http://localhost:5000/admin/queues</code>
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Live queue monitoring showing Delayed jobs moving to Active and Completed states.
                    </p>
                  </div>
                </div>

                <a
                  href="http://localhost:5000/admin/queues"
                  target="_blank"
                  rel="noreferrer"
                  className="self-start sm:self-auto px-3 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition flex items-center gap-1"
                >
                  <span>Launch Bull Board</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px] font-mono text-center pt-1">
                <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">1. Schedule</span>
                  <span className="text-white font-semibold">PostgreSQL Saved</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">2. BullMQ</span>
                  <span className="text-amber-400 font-semibold">Delayed Job Created</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">3. Bull Board</span>
                  <span className="text-cyan-400 font-semibold">Shows in "Delayed"</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                  <span className="text-slate-500 block text-[9px]">4. Worker</span>
                  <span className="text-indigo-400 font-semibold">Processes Job</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 col-span-2 md:col-span-1">
                  <span className="text-slate-500 block text-[9px]">5. Completed</span>
                  <span className="text-emerald-400 font-semibold">Status = Sent</span>
                </div>
              </div>
            </div>

            {filteredScheduled.length === 0 ? (
              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-12 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">No Scheduled Emails in Queue</h4>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                    All jobs have been dispatched or no delayed jobs are currently pending.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('composer')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500 text-slate-950 font-bold text-xs shadow-lg shadow-teal-500/20 hover:bg-teal-400 transition"
                >
                  <Send className="w-3.5 h-3.5" />
                  Schedule a Test Email (15s delay)
                </button>
              </div>
            ) : queueViewMode === 'table' ? (
              /* Scheduled Queue Table View */
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Recipient</th>
                        <th className="py-3 px-4">Subject</th>
                        <th className="py-3 px-4">Sender</th>
                        <th className="py-3 px-4">Scheduled For</th>
                        <th className="py-3 px-4">Countdown</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredScheduled.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-800/30 transition">
                          {/* Status */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 font-semibold text-[11px]">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                              Scheduled
                            </span>
                          </td>

                          {/* Recipient */}
                          <td className="py-3.5 px-4 font-mono text-teal-300 whitespace-nowrap">
                            {item.recipient}
                          </td>

                          {/* Subject */}
                          <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate" title={item.subject}>
                            {item.subject}
                          </td>

                          {/* Sender */}
                          <td className="py-3.5 px-4 text-slate-300 font-mono text-[11px] max-w-xs truncate" title={getSenderLabel(item.sender_id)}>
                            {getSenderLabel(item.sender_id)}
                          </td>

                          {/* Scheduled Time */}
                          <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap font-mono">
                            {new Date(item.scheduled_at).toLocaleTimeString()}
                          </td>

                          {/* Countdown */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="font-mono text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/50 text-[11px]">
                              {formatCountdown(item.scheduled_at)}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                            <button
                              onClick={() => setPreviewEmail(item)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition"
                            >
                              View Body
                            </button>
                            <button
                              onClick={() => handleCancelEmail(item.id)}
                              className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-xs transition"
                              title="Cancel scheduled job"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Scheduled Queue Cards View */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredScheduled.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-4 hover:border-amber-500/40 transition duration-200 shadow-xl flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                          {formatCountdown(item.scheduled_at)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          ID: {item.id.slice(-6)}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-white truncate" title={item.subject}>
                        {item.subject}
                      </h4>
                      <p className="text-xs text-teal-400 font-mono truncate" title={item.recipient}>
                        To: {item.recipient}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono truncate" title={getSenderLabel(item.sender_id)}>
                        From: {getSenderLabel(item.sender_id)}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 space-y-3">
                      <div className="text-[11px] text-slate-400 flex items-center justify-between font-mono">
                        <span>Scheduled:</span>
                        <span>{new Date(item.scheduled_at).toLocaleTimeString()}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPreviewEmail(item)}
                          className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition"
                        >
                          View Body
                        </button>
                        <button
                          onClick={() => handleCancelEmail(item.id)}
                          className="p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-xs transition"
                          title="Cancel scheduled job"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DELIVERY HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Sent & Execution Logs
                </h3>
                <p className="text-xs text-slate-400">
                  Emails processed by workers with real-time delivery state, error reports, and live Ethereal sandbox preview links.
                </p>
              </div>

              {/* Status filter tabs */}
              <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                {['all', 'sent', 'failed', 'cancelled'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setHistoryFilter(f)}
                    className={`px-3 py-1 rounded-md capitalize font-medium transition ${
                      historyFilter === f
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/30 p-12 text-center space-y-3">
                <CheckCircle2 className="w-8 h-8 text-slate-500 mx-auto" />
                <h4 className="text-sm font-semibold text-white">No Email Delivery Logs</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Once scheduled jobs reach their scheduled execution timestamp, their delivery logs and Ethereal preview links will appear here.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/80 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Recipient</th>
                        <th className="py-3 px-4">Subject</th>
                        <th className="py-3 px-4">Sender</th>
                        <th className="py-3 px-4">Delivered At</th>
                        <th className="py-3 px-4 text-right">Actions / Sandbox</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredHistory.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-800/30 transition">
                          {/* Status */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {item.status === 'sent' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-semibold text-[11px]">
                                <Check className="w-3 h-3 text-emerald-400" />
                                Delivered
                              </span>
                            )}
                            {item.status === 'failed' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950/80 text-rose-300 border border-rose-800/60 font-semibold text-[11px]">
                                <XCircle className="w-3 h-3 text-rose-400" />
                                Failed
                              </span>
                            )}
                            {item.status === 'cancelled' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-semibold text-[11px]">
                                Cancelled
                              </span>
                            )}
                            {item.status === 'processing' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 font-semibold text-[11px] animate-pulse">
                                Processing
                              </span>
                            )}
                          </td>

                          {/* Recipient */}
                          <td className="py-3.5 px-4 font-mono text-slate-200 whitespace-nowrap">
                            {item.recipient}
                          </td>

                          {/* Subject */}
                          <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate" title={item.subject}>
                            {item.subject}
                          </td>

                          {/* Sender */}
                          <td className="py-3.5 px-4 text-slate-300 font-mono text-[11px] max-w-xs truncate" title={getSenderLabel(item.sender_id)}>
                            {getSenderLabel(item.sender_id)}
                          </td>

                          {/* Delivered At */}
                          <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap font-mono">
                            {item.sent_at ? new Date(item.sent_at).toLocaleTimeString() : '—'}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                            {/* Ethereal Preview Button */}
                            {item.preview_url ? (
                              <a
                                href={item.preview_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 text-xs font-semibold transition"
                                title="Open rendered message on Ethereal sandbox"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View Ethereal Mail
                              </a>
                            ) : null}

                            {/* View body */}
                            <button
                              onClick={() => setPreviewEmail(item)}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                              title="Inspect Email Content"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {/* Retry button for failed/cancelled */}
                            {(item.status === 'failed' || item.status === 'cancelled') && (
                              <button
                                onClick={() => handleRetryEmail(item.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs transition"
                                title="Retry delivery now"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Retry
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SCHEDULE COMPOSER (SINGLE) */}
        {activeTab === 'composer' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Form */}
            <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Send className="w-4 h-4 text-teal-400" />
                  Compose Scheduled Email
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure email recipient, content, and scheduling trigger.
                </p>
              </div>

              {/* Template quick-pick */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  Quick Load Template
                </label>
                <div className="flex flex-wrap gap-2">
                  {EMAIL_TEMPLATES.map((tmpl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSubject(tmpl.subject);
                        setBody(tmpl.body);
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/60 transition"
                    >
                      {tmpl.name}
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleScheduleSubmit} className="space-y-4">
                {/* Sender Selector & Hourly Limit Info */}
                {senders.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-teal-400" />
                        Outbound Email Sender
                      </label>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        Quota: 200 emails / hr (Phase D Rate Limiting)
                      </span>
                    </div>
                    <select
                      value={selectedSenderId}
                      onChange={(e) => setSelectedSenderId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-teal-500 font-mono"
                    >
                      {senders.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} &lt;{s.email}&gt; {s.is_default ? '★ (Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Recipient Input with CSV/TXT Upload & Recipient Count */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-teal-400" />
                      Recipient(s) — Email or CSV/TXT List
                    </label>

                    <div className="flex items-center gap-2">
                      {/* Recipient Count Badge */}
                      <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-300 border border-teal-500/20">
                        {recipient.split(/[\n,;]+/).filter((e) => e.trim().includes('@')).length} recipient(s)
                      </span>

                      {/* CSV / TXT Upload Button */}
                      <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-700 text-xs font-medium transition shadow-sm">
                        <Upload className="w-3 h-3 text-teal-400" />
                        <span>Upload CSV / TXT</span>
                        <input
                          type="file"
                          accept=".csv,.txt"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  <textarea
                    rows={recipient.includes('\n') ? 4 : 2}
                    required
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="Enter email, or paste multiple comma/newline-separated addresses..."
                    className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-teal-500 font-mono"
                  ></textarea>
                  <p className="text-[11px] text-slate-500">
                    Supports individual addresses, comma-separated lists, or bulk CSV/TXT imports.
                  </p>
                </div>

                {/* Subject */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Email Subject</label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Campaign subject line..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Body (HTML / Plain text) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300">Email Content (HTML Supported)</label>
                    <span className="text-[11px] text-teal-400 font-mono">Rendered by Nodemailer</span>
                  </div>
                  <textarea
                    rows={6}
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-teal-500"
                  ></textarea>
                </div>

                {/* Schedule Trigger Selector */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-4">
                  <label className="text-xs font-semibold text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-400" />
                    Delivery Schedule Timing
                  </label>

                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scheduleType"
                        checked={scheduleType === 'delay'}
                        onChange={() => setScheduleType('delay')}
                        className="text-teal-500"
                      />
                      <span>Relative Delay</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="scheduleType"
                        checked={scheduleType === 'datetime'}
                        onChange={() => setScheduleType('datetime')}
                        className="text-teal-500"
                      />
                      <span>Exact Date & Time</span>
                    </label>
                  </div>

                  {scheduleType === 'delay' ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {[
                          { label: 'Immediate (0s)', val: 0 },
                          { label: '15 seconds', val: 15 },
                          { label: '1 minute', val: 60 },
                          { label: '5 minutes', val: 300 },
                          { label: '1 hour', val: 3600 },
                        ].map((btn) => (
                          <button
                            key={btn.val}
                            type="button"
                            onClick={() => setDelaySeconds(btn.val)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                              delaySeconds === btn.val
                                ? 'bg-teal-500 text-slate-950 font-bold'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <span className="text-xs text-slate-400">Custom Delay (Seconds):</span>
                        <input
                          type="number"
                          min="0"
                          value={delaySeconds}
                          onChange={(e) => setDelaySeconds(Number(e.target.value))}
                          className="w-24 px-3 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400">Select Date and Time</label>
                      <input
                        type="datetime-local"
                        required={scheduleType === 'datetime'}
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono"
                      />
                    </div>
                  )}

                  {/* Delay Between Emails (Stagger) - active when > 1 recipient */}
                  {recipient.split(/[\n,;]+/).filter((e) => e.trim().includes('@')).length > 1 && (
                    <div className="p-3.5 rounded-xl border border-teal-500/30 bg-teal-950/20 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-teal-300">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-teal-400" />
                          Delay Between Emails (Interval Stagger)
                        </span>
                        <span className="font-mono text-[10px] text-teal-400">Respects SMTP Provider Quotas</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={staggerSeconds}
                          onChange={(e) => setStaggerSeconds(Number(e.target.value))}
                          className="w-24 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono"
                        />
                        <span className="text-xs text-slate-400">
                          seconds between consecutive emails
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={composerSubmitting}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-teal-500 to-indigo-500 hover:from-teal-400 hover:to-indigo-400 text-slate-950 font-extrabold text-sm shadow-xl shadow-teal-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {composerSubmitting
                    ? 'Scheduling Delivery...'
                    : recipient.split(/[\n,;]+/).filter((e) => e.trim().includes('@')).length > 1
                    ? `Schedule ${recipient.split(/[\n,;]+/).filter((e) => e.trim().includes('@')).length} Emails (Staggered Batch)`
                    : 'Schedule Email Delivery'}
                </button>
              </form>
            </div>

            {/* Sidebar Guide */}
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  How Delayed Scheduling Works
                </h4>
                <ul className="text-xs text-slate-400 space-y-2.5 leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0"></span>
                    <span>
                      Job is dispatched to <strong>BullMQ</strong> with an exact computed millisecond delay.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0"></span>
                    <span>
                      Redis persists the job key across server restarts, zero job loss.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0"></span>
                    <span>
                      Worker picks up the job automatically when delay expires and calls Nodemailer.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1.5 shrink-0"></span>
                    <span>
                      An <strong>Ethereal preview link</strong> is immediately created to view the formatted email online.
                    </span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-300">Queue Concurrency & Limits</h4>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Concurrency:</span>
                    <span className="text-teal-400 font-bold">5 parallel jobs</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Rate Limiter:</span>
                    <span className="text-cyan-400 font-bold">10 emails / second</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Retry Strategy:</span>
                    <span className="text-amber-400 font-bold">Exponential Backoff</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: BATCH CAMPAIGN COMPOSER */}
        {activeTab === 'batch' && (
          <div className="max-w-3xl mx-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl space-y-6">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-400" />
                Batch & Staggered Outbound Campaign
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Schedule multiple recipients with progressive interval staggering to respect SMTP provider rate limits.
              </p>
            </div>

            <form onSubmit={handleBatchSubmit} className="space-y-4">
              {/* Sender Selector for Batch */}
              {senders.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-teal-400" />
                      Outbound Email Sender
                    </span>
                    <span className="text-[10px] font-mono text-teal-400">Phase C Multi-Sender</span>
                  </label>
                  <select
                    value={batchSenderId}
                    onChange={(e) => setBatchSenderId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-teal-500 font-mono"
                  >
                    {senders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} &lt;{s.email}&gt; {s.is_default ? '★ (Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Recipient List (One email per line or comma-separated)
                </label>
                <textarea
                  rows={4}
                  required
                  value={batchRecipients}
                  onChange={(e) => setBatchRecipients(e.target.value)}
                  placeholder="user1@example.com&#10;user2@example.com&#10;user3@example.com"
                  className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-teal-500"
                ></textarea>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Campaign Subject</label>
                <input
                  type="text"
                  required
                  value={batchSubject}
                  onChange={(e) => setBatchSubject(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Campaign HTML Body</label>
                <textarea
                  rows={4}
                  required
                  value={batchBody}
                  onChange={(e) => setBatchBody(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-teal-500"
                ></textarea>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-800 bg-slate-950/60">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Base Initial Delay (Seconds)</label>
                  <input
                    type="number"
                    min="0"
                    value={batchBaseDelay}
                    onChange={(e) => setBatchBaseDelay(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono"
                  />
                  <p className="text-[11px] text-slate-500">Wait before the first email fires</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Stagger Interval (Seconds)</label>
                  <input
                    type="number"
                    min="1"
                    value={batchStagger}
                    onChange={(e) => setBatchStagger(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono"
                  />
                  <p className="text-[11px] text-slate-500">Delay between each successive email</p>
                </div>
              </div>

              <button
                type="submit"
                disabled={batchSubmitting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-500 to-indigo-500 hover:from-teal-400 hover:to-indigo-400 text-slate-950 font-extrabold text-sm shadow-xl shadow-teal-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Users className="w-4 h-4" />
                {batchSubmitting ? 'Enqueueing Batch...' : 'Schedule Staggered Batch'}
              </button>
            </form>
          </div>
        )}

        {/* TAB 5: SLACK OAUTH & ALERTING (PHASE E) */}
        {activeTab === 'slack' && (
          <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
            {/* Header Banner */}
            <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-950/40 via-slate-900/60 to-slate-900/40 p-6 shadow-2xl backdrop-blur-md relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-lg shadow-purple-500/20">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-bold text-white">Slack OAuth & Automated Alerts</h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold">
                        Phase E
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Real-time alert dispatch to your Slack workspace whenever any sender reaches the hourly limit of 200 emails/hour.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                      slackStatus?.connected
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        slackStatus?.connected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                      }`}
                    ></span>
                    {slackStatus?.connected ? 'Integration Active' : 'Not Connected'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left 2 Cols: Connection Controls */}
              <div className="lg:col-span-2 space-y-6">
                {/* Connection Status Card */}
                {slackStatus?.connected ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5 shadow-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white">
                            Connected to {slackStatus.data?.teamName || 'Slack Workspace'}
                          </h4>
                          <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 font-mono">
                            <Hash className="w-3 h-3 text-purple-400" />
                            Target Channel: {slackStatus.data?.channel || '#email-alerts'}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleDisconnectSlack}
                        className="px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 text-xs font-semibold transition"
                      >
                        Disconnect
                      </button>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs font-mono">
                      <div className="flex justify-between text-slate-400">
                        <span>Workspace / Team:</span>
                        <span className="text-white font-semibold">{slackStatus.data?.teamName || 'Direct Webhook'}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Alert Channel:</span>
                        <span className="text-teal-400 font-semibold">{slackStatus.data?.channel || '#email-alerts'}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Database Persistence:</span>
                        <span className="text-emerald-400">PostgreSQL (slack_integrations)</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Connected At:</span>
                        <span className="text-slate-300">
                          {slackStatus.data?.updatedAt
                            ? new Date(slackStatus.data.updatedAt).toLocaleString()
                            : 'Active'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                      <button
                        onClick={handleTestSlackAlert}
                        disabled={slackTesting}
                        className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white font-bold text-xs shadow-lg shadow-purple-500/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        <Bell className={`w-4 h-4 ${slackTesting ? 'animate-bounce' : ''}`} />
                        {slackTesting ? 'Dispatching Live Alert...' : 'Send Live Test Slack Alert'}
                      </button>

                      <a
                        href="/api/slack/oauth/start"
                        className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold text-center border border-slate-700 transition"
                      >
                        Re-authenticate with OAuth
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-6 shadow-xl">
                    <div className="space-y-2">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-purple-400" />
                        Option 1: Connect via Slack OAuth 2.0
                      </h4>
                      <p className="text-xs text-slate-400">
                        Authorize our app directly using Slack’s official OAuth 2.0 flow. Slack will redirect back with an authorization code to store your workspace credentials securely.
                      </p>
                      <div className="pt-2">
                        <a
                          href="/api/slack/oauth/start"
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-500/20 transition"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                          </svg>
                          Connect with Slack OAuth
                        </a>
                      </div>
                    </div>

                    <div className="relative flex py-2 items-center">
                      <div className="flex-grow border-t border-slate-800"></div>
                      <span className="flex-shrink mx-4 text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                        Or direct connection
                      </span>
                      <div className="flex-grow border-t border-slate-800"></div>
                    </div>

                    {/* Direct Webhook Form */}
                    <form onSubmit={handleConnectSlackWebhook} className="space-y-3">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Hash className="w-4 h-4 text-teal-400" />
                        Option 2: Direct Incoming Webhook URL
                      </h4>
                      <p className="text-xs text-slate-400">
                        Paste any Slack Incoming Webhook URL (e.g. <code>https://hooks.slack.com/services/...</code>) or use the mock webhook to test instantly.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          required
                          placeholder="https://hooks.slack.com/services/T00/B00/XXXX"
                          value={slackWebhookUrl}
                          onChange={(e) => setSlackWebhookUrl(e.target.value)}
                          className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 font-mono"
                        />
                        <button
                          type="submit"
                          disabled={slackConnecting}
                          className="px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs transition shrink-0 disabled:opacity-50"
                        >
                          {slackConnecting ? 'Connecting...' : 'Save & Activate'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Rate Limiting Alert Verification Card */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                      <ShieldAlert className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Automated Rate Limit Trigger</h4>
                      <p className="text-xs text-slate-400">
                        Triggered automatically by the BullMQ worker when a sender exceeds the hourly quota.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">Hourly Quota</span>
                      <span className="text-teal-400 font-bold">200 emails / hr</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">On Limit Exceeded</span>
                      <span className="text-amber-400 font-bold">Reschedule to Next Hour</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">Alert Dispatch</span>
                      <span className="text-purple-400 font-bold">Slack Real-time Block</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Col: Architecture & Guide */}
              <div className="space-y-6">
                <div className="rounded-2xl border border-purple-500/20 bg-purple-950/10 p-5 space-y-4">
                  <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5" />
                    Alert Architecture Flow
                  </h4>
                  <ol className="space-y-3 text-xs text-slate-300">
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 font-mono text-[10px] font-bold">
                        1
                      </span>
                      <span>
                        <strong>Sender Rate Check:</strong> BullMQ worker checks Redis <code>rate_limit:senderId:hour</code> before sending.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 font-mono text-[10px] font-bold">
                        2
                      </span>
                      <span>
                        <strong>Never-Drop Policy:</strong> If limit (200/hr) is reached, email is delayed to the next hour window.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0 font-mono text-[10px] font-bold">
                        3
                      </span>
                      <span>
                        <strong>Slack Dispatch:</strong> A structured Block Kit message is sent to the configured Slack channel.
                      </span>
                    </li>
                  </ol>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                  <h4 className="text-xs font-bold text-slate-300">Block Kit Message Payload</h4>
                  <p className="text-xs text-slate-400">
                    Includes sender identity, current count, hourly limit, rescheduled timestamp, and recipient details.
                  </p>
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-purple-300 leading-relaxed overflow-x-auto">
                    🚨 <strong>RATE LIMIT EXCEEDED</strong><br />
                    Sender: Default SMTP<br />
                    Limit: 200/hour<br />
                    Deferred Until: Next Hour Window<br />
                    Status: Rescheduled (Not Dropped)
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
          </>
        )}
      </main>

      {/* Email Body Inspector Modal */}
      {currentUser && previewEmail && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 max-w-2xl w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">{previewEmail.subject}</h3>
                <p className="text-xs text-teal-400 font-mono mt-0.5">To: {previewEmail.recipient}</p>
              </div>
              <button
                onClick={() => setPreviewEmail(null)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span>Message Body Preview</span>
                {previewEmail.preview_url && (
                  <a
                    href={previewEmail.preview_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-teal-400 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open in Ethereal
                  </a>
                )}
              </div>
              <div
                className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-200 overflow-y-auto max-h-80 prose prose-invert"
                dangerouslySetInnerHTML={{ __html: previewEmail.body }}
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setPreviewEmail(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
