import { useEffect, useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTheme } from '@/contexts/ThemeContext'
import { useUpdateCheck, useUpdateMutations } from '@/hooks/useUpdateCheck'
import { clearVoiceConfigCache } from '@/hooks/useVoiceConfig'
import { useKokoroTTS } from '@/hooks/useKokoroTTS'
import { getAvailableVoices as getKokoroVoices } from '@/lib/kokoroTTS'
import {
  Sun,
  Moon,
  Monitor,
  Palette,
  Plug,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Copy,
  Terminal,
  Settings2,
  RotateCcw,
  ArrowRight,
  Mic,
  Volume2,
  Download,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import type { ColorTheme } from '@/themes'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface VersionInfo {
  cli: string
  server: string
  frontend: string
}

interface PluginInfo {
  name: string
  displayName?: string
  package: string
  version?: string
  description?: string
  installed: boolean
  activated: boolean
  enabled: boolean
  configSchema?: {
    type: string
    properties: Record<
      string,
      {
        type: string
        title?: string
        description?: string
        default?: unknown
        required?: boolean
        enum?: string[]
      }
    >
    required?: string[]
  }
  options?: Record<string, unknown>
  // Plugin capabilities
  capabilities?: {
    supportsWatch: boolean
    supportsPolling: boolean
    supportsOnDemandImport: boolean
    supportsSearch: boolean
    supportsPush: boolean
  }
  // Integration-level config (separate from plugin-specific options)
  integrationConfig?: {
    auto_sync?: boolean
    auto_import?: boolean
    delete_behavior?: 'close' | 'delete' | 'ignore'
    conflict_resolution?: 'newest-wins' | 'sudocode-wins' | 'external-wins' | 'manual'
    default_sync_direction?: 'inbound' | 'outbound' | 'bidirectional'
  }
}

interface PluginTestResult {
  success: boolean
  error?: string
  details?: Record<string, unknown>
}

type SettingsTab = 'general' | 'voice' | 'integrations'

// Section configuration for sidebar navigation
interface Section {
  id: SettingsTab
  label: string
  icon: React.ReactNode
}

const SECTIONS: Section[] = [
  { id: 'general', label: 'General', icon: <Settings2 className="h-4 w-4" /> },
  { id: 'voice', label: 'Voice', icon: <Mic className="h-4 w-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug className="h-4 w-4" /> },
]

// Voice settings interface (server-side config)
interface VoiceSettings {
  enabled?: boolean
  stt?: {
    provider?: 'whisper-local' | 'openai'
    whisperUrl?: string
    whisperModel?: string
  }
  tts?: {
    provider?: 'browser' | 'kokoro' | 'openai'
    defaultVoice?: string
  }
  narration?: {
    enabled?: boolean
    voice?: string
    speed?: number
    volume?: number
    narrateToolUse?: boolean
    narrateToolResults?: boolean
    narrateAssistantMessages?: boolean
  }
}

// Theme preview swatch component
function ThemePreviewSwatch({ theme }: { theme: ColorTheme }) {
  return (
    <div className="flex h-4 w-6 overflow-hidden rounded-sm border border-border">
      <div className="w-1/2" style={{ backgroundColor: `hsl(${theme.colors.background})` }} />
      <div className="w-1/2" style={{ backgroundColor: `hsl(${theme.colors.primary})` }} />
    </div>
  )
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const {
    mode,
    setMode,
    actualMode,
    lightTheme,
    darkTheme,
    setLightTheme,
    setDarkTheme,
    availableLightThemes,
    availableDarkThemes,
  } = useTheme()
  const [versions, setVersions] = useState<VersionInfo | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loadingPlugins, setLoadingPlugins] = useState(false)
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null)
  const [testingPlugin, setTestingPlugin] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, PluginTestResult>>({})
  const [savingPlugin, setSavingPlugin] = useState<string | null>(null)
  const [syncingPlugin, setSyncingPlugin] = useState<string | null>(null)
  const [pluginOptions, setPluginOptions] = useState<Record<string, Record<string, unknown>>>({})
  const [integrationConfigs, setIntegrationConfigs] = useState<
    Record<string, PluginInfo['integrationConfig']>
  >({})
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [installing, setInstalling] = useState(false)

  // Voice settings state (server-side config)
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({})
  const [loadingVoice, setLoadingVoice] = useState(false)
  const [savingVoice, setSavingVoice] = useState(false)
  const voiceSettingsLoadedRef = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Available voices from Web Speech API
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])

  // Kokoro TTS hook for model management
  const kokoroTTS = useKokoroTTS()

  // Update check hooks
  const { updateInfo } = useUpdateCheck()
  const { installUpdate, restartServer } = useUpdateMutations()
  const [updateSuccess, setUpdateSuccess] = useState(false)

  // Preset plugins available for installation
  const presetPlugins = [
    { name: 'github', package: '@sudocode-ai/integration-github', displayName: 'GitHub Issues' },
    { name: 'spec-kit', package: '@sudocode-ai/integration-speckit', displayName: 'Spec-Kit' },
    { name: 'openspec', package: '@sudocode-ai/integration-openspec', displayName: 'OpenSpec' },
    { name: 'beads', package: '@sudocode-ai/integration-beads', displayName: 'Beads' },
  ]

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const data = await api.get<VersionInfo, VersionInfo>('/version')
        setVersions(data)
      } catch (error) {
        console.error('Failed to fetch version information:', error)
      }
    }

    if (isOpen) {
      fetchVersions()
    }
  }, [isOpen])

  useEffect(() => {
    const fetchPlugins = async () => {
      setLoadingPlugins(true)
      try {
        const data = await api.get<{ plugins: PluginInfo[] }, { plugins: PluginInfo[] }>('/plugins')
        setPlugins(data.plugins)
        // Initialize options state
        const optionsState: Record<string, Record<string, unknown>> = {}
        const configsState: Record<string, PluginInfo['integrationConfig']> = {}
        data.plugins.forEach((p) => {
          optionsState[p.name] = p.options || {}
          configsState[p.name] = p.integrationConfig || {}
        })
        setPluginOptions(optionsState)
        setIntegrationConfigs(configsState)
      } catch (error) {
        console.error('Failed to fetch plugins:', error)
      } finally {
        setLoadingPlugins(false)
      }
    }

    if (isOpen && activeTab === 'integrations') {
      fetchPlugins()
    }
  }, [isOpen, activeTab])

  // Fetch voice settings when voice tab is opened
  useEffect(() => {
    const fetchVoiceSettings = async () => {
      setLoadingVoice(true)
      voiceSettingsLoadedRef.current = false
      try {
        // Voice settings are now included in the combined /voice/config endpoint
        const data = await api.get<{ settings: VoiceSettings }, { settings: VoiceSettings }>(
          '/voice/config'
        )
        setVoiceSettings(data.settings || {})
        // Mark as loaded after a short delay to prevent immediate save
        setTimeout(() => {
          voiceSettingsLoadedRef.current = true
        }, 100)
      } catch (error) {
        console.error('Failed to fetch voice settings:', error)
      } finally {
        setLoadingVoice(false)
      }
    }

    if (isOpen && activeTab === 'voice') {
      fetchVoiceSettings()
    }
  }, [isOpen, activeTab])

  // Reset loaded state when dialog closes
  useEffect(() => {
    if (!isOpen) {
      voiceSettingsLoadedRef.current = false
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = null
      }
    }
  }, [isOpen])

  // Load available voices from Web Speech API
  useEffect(() => {
    if (!isOpen || activeTab !== 'voice') return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    const synth = window.speechSynthesis

    const loadVoices = () => {
      const voices = synth.getVoices()
      setAvailableVoices(voices)
    }

    // Voices may be loaded asynchronously
    loadVoices()
    synth.addEventListener('voiceschanged', loadVoices)

    return () => {
      synth.removeEventListener('voiceschanged', loadVoices)
    }
  }, [isOpen, activeTab])

  // Auto-save voice settings with debounce
  const saveVoiceSettings = useCallback(async (settings: VoiceSettings) => {
    setSavingVoice(true)
    try {
      await api.put('/config/voice', settings)
      // Clear the voice config cache so other components get fresh data
      clearVoiceConfigCache()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save voice settings'
      toast.error(message)
    } finally {
      setSavingVoice(false)
    }
  }, [])

  // Debounced auto-save effect
  useEffect(() => {
    // Don't save if not loaded yet (prevents saving on initial load)
    if (!voiceSettingsLoadedRef.current) {
      return
    }

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce the save
    saveTimeoutRef.current = setTimeout(() => {
      saveVoiceSettings(voiceSettings)
    }, 500)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [voiceSettings, saveVoiceSettings])

  // Update voice settings helper
  const updateVoiceSettings = (updates: Partial<VoiceSettings>) => {
    setVoiceSettings((prev) => ({ ...prev, ...updates }))
  }

  const updateVoiceSTTSettings = (updates: Partial<NonNullable<VoiceSettings['stt']>>) => {
    setVoiceSettings((prev) => ({
      ...prev,
      stt: { ...prev.stt, ...updates },
    }))
  }

  const updateVoiceTTSSettings = (updates: Partial<NonNullable<VoiceSettings['tts']>>) => {
    setVoiceSettings((prev) => ({
      ...prev,
      tts: { ...prev.tts, ...updates },
    }))
  }

  const updateVoiceNarrationSettings = (updates: Partial<NonNullable<VoiceSettings['narration']>>) => {
    setVoiceSettings((prev) => ({
      ...prev,
      narration: { ...prev.narration, ...updates },
    }))
  }

  // Get options with defaults from schema applied
  const getOptionsWithDefaults = (plugin: PluginInfo): Record<string, unknown> => {
    const currentOptions = pluginOptions[plugin.name] || {}
    const defaults: Record<string, unknown> = {}

    // Extract defaults from configSchema
    if (plugin.configSchema?.properties) {
      for (const [key, prop] of Object.entries(plugin.configSchema.properties)) {
        if (prop.default !== undefined) {
          defaults[key] = prop.default
        }
      }
    }

    // Merge: defaults first, then current options override
    return { ...defaults, ...currentOptions }
  }

  const handleTogglePlugin = async (plugin: PluginInfo) => {
    try {
      if (plugin.enabled) {
        await api.post(`/plugins/${plugin.name}/deactivate`, {})
        toast.success(`${plugin.displayName || plugin.name} disabled`)
      } else {
        const options = getOptionsWithDefaults(plugin)
        await api.post(`/plugins/${plugin.name}/activate`, { options })
        toast.success(`${plugin.displayName || plugin.name} enabled`)
      }
      // Refresh plugins
      const data = await api.get<{ plugins: PluginInfo[] }, { plugins: PluginInfo[] }>('/plugins')
      setPlugins(data.plugins)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle plugin'
      toast.error(message)
    }
  }

  const handleTestPlugin = async (pluginName: string) => {
    setTestingPlugin(pluginName)
    try {
      const result = await api.post<PluginTestResult, PluginTestResult>(
        `/plugins/${pluginName}/test`,
        {}
      )
      setTestResults((prev) => ({ ...prev, [pluginName]: result }))
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [pluginName]: { success: false, error: 'Test failed' },
      }))
    } finally {
      setTestingPlugin(null)
    }
  }

  const handleSaveOptions = async (pluginName: string) => {
    setSavingPlugin(pluginName)
    try {
      // Save both plugin options and integration config
      await api.put(`/plugins/${pluginName}/options`, {
        options: pluginOptions[pluginName] || {},
        integrationConfig: integrationConfigs[pluginName] || {},
      })
      toast.success('Settings saved')
      // Refresh plugins
      const data = await api.get<{ plugins: PluginInfo[] }, { plugins: PluginInfo[] }>('/plugins')
      setPlugins(data.plugins)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings'
      toast.error(message)
    } finally {
      setSavingPlugin(null)
    }
  }

  const handleSyncPlugin = async (pluginName: string) => {
    setSyncingPlugin(pluginName)
    try {
      const result = await api.post<
        {
          message: string
          results: Array<{ entity_id: string; action: string; success: boolean }>
        },
        { message: string; results: Array<{ entity_id: string; action: string; success: boolean }> }
      >(`/plugins/${pluginName}/sync`, {})

      const created = result.results?.filter((r) => r.action === 'created' && r.success).length || 0
      const updated = result.results?.filter((r) => r.action === 'updated' && r.success).length || 0
      const total = result.results?.length || 0

      if (created > 0 || updated > 0) {
        toast.success(`Sync complete: ${created} created, ${updated} updated`)
      } else if (total > 0) {
        toast.info(`Sync complete: ${total} entities checked, no changes needed`)
      } else {
        toast.info('Sync complete: no entities found')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync'
      toast.error(message)
    } finally {
      setSyncingPlugin(null)
    }
  }

  const updatePluginOption = (pluginName: string, key: string, value: unknown) => {
    setPluginOptions((prev) => ({
      ...prev,
      [pluginName]: {
        ...prev[pluginName],
        [key]: value,
      },
    }))
  }

  const updateIntegrationConfig = (
    pluginName: string,
    key: keyof NonNullable<PluginInfo['integrationConfig']>,
    value: unknown
  ) => {
    setIntegrationConfigs((prev) => ({
      ...prev,
      [pluginName]: {
        ...prev[pluginName],
        [key]: value,
      },
    }))
  }

  const copyInstallCommand = async (pluginName: string, packageName: string) => {
    const command = `npm install ${packageName}`
    try {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(pluginName)
      setTimeout(() => setCopiedCommand(null), 2000)
    } catch (error) {
      console.error('Failed to copy command:', error)
    }
  }

  const handleInstallPlugin = async () => {
    if (!selectedPreset) return
    const preset = presetPlugins.find((p) => p.name === selectedPreset)
    if (!preset) return

    setInstalling(true)
    try {
      const result = await api.post<
        { message: string; alreadyInstalled?: boolean; requiresRestart?: boolean },
        { message: string; alreadyInstalled?: boolean; requiresRestart?: boolean }
      >(`/plugins/${preset.name}/install`, { package: preset.package })

      if (result?.alreadyInstalled) {
        toast.info(`${preset.displayName} is already installed`)
      } else if (result?.requiresRestart) {
        toast.success(
          `${preset.displayName} installed successfully. Please restart the server to use it.`,
          { duration: 10000 }
        )
      } else {
        toast.success(`${preset.displayName} installed successfully`)
      }
      // Note: Don't refresh plugins list if restart is required
      // The plugin won't be loadable until after restart
      if (!result?.requiresRestart) {
        const data = await api.get<{ plugins: PluginInfo[] }, { plugins: PluginInfo[] }>('/plugins')
        setPlugins(data.plugins)
        const newPlugin = data.plugins.find((p) => p.name === preset.name)
        if (newPlugin) {
          setPluginOptions((prev) => ({
            ...prev,
            [preset.name]: newPlugin.options || {},
          }))
        }
      }
      setSelectedPreset('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install plugin'
      toast.error(message)
    } finally {
      setInstalling(false)
    }
  }

  const renderPluginConfig = (plugin: PluginInfo) => {
    const options = pluginOptions[plugin.name] || {}
    const config = integrationConfigs[plugin.name] || {}

    return (
      <div className="mt-3 space-y-4 border-t border-border pt-3">
        {/* Plugin-specific options - only show if there are actual properties */}
        {plugin.configSchema?.properties &&
          Object.keys(plugin.configSchema.properties).length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground">Plugin Settings</h4>
              {Object.entries(plugin.configSchema.properties).map(([key, prop]) => {
                const isRequired = plugin.configSchema?.required?.includes(key) || prop.required
                const value = options[key] ?? prop.default ?? ''

                return prop.type === 'boolean' ? (
                  <div key={key} className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-xs">
                        {prop.title || key}
                        {isRequired && <span className="ml-1 text-destructive">*</span>}
                      </Label>
                      {prop.description && (
                        <p className="text-[10px] text-muted-foreground">{prop.description}</p>
                      )}
                    </div>
                    <Switch
                      checked={Boolean(value)}
                      onCheckedChange={(checked) => updatePluginOption(plugin.name, key, checked)}
                    />
                  </div>
                ) : (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs">
                      {prop.title || key}
                      {isRequired && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <Input
                      value={String(value)}
                      onChange={(e) => updatePluginOption(plugin.name, key, e.target.value)}
                      placeholder={prop.description}
                      className="h-8 text-sm"
                    />
                    {prop.description && (
                      <p className="text-[10px] text-muted-foreground">{prop.description}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

        {/* Integration-level settings - only show for plugins that support real-time sync */}
        {(plugin.capabilities?.supportsWatch || plugin.capabilities?.supportsPolling) && (
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground">Sync Settings</h4>

            {/* Auto Sync */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Auto Sync</Label>
                <p className="text-[10px] text-muted-foreground">
                  Automatically sync changes in real-time
                </p>
              </div>
              <Switch
                checked={config.auto_sync ?? false}
                onCheckedChange={(checked) =>
                  updateIntegrationConfig(plugin.name, 'auto_sync', checked)
                }
              />
            </div>

            {/* Auto Import */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Auto Import</Label>
                <p className="text-[10px] text-muted-foreground">
                  Automatically import new issues from external system
                </p>
              </div>
              <Switch
                checked={config.auto_import ?? true}
                onCheckedChange={(checked) =>
                  updateIntegrationConfig(plugin.name, 'auto_import', checked)
                }
              />
            </div>

            {/* Delete Behavior */}
            <div className="space-y-1">
              <Label className="text-xs">Delete Behavior</Label>
              <Select
                value={config.delete_behavior ?? 'close'}
                onValueChange={(value) =>
                  updateIntegrationConfig(plugin.name, 'delete_behavior', value)
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="close">Close issue</SelectItem>
                  <SelectItem value="delete">Delete issue</SelectItem>
                  <SelectItem value="ignore">Do nothing</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                What to do when a linked issue is deleted on either side
              </p>
            </div>

            {/* Conflict Resolution */}
            <div className="space-y-1">
              <Label className="text-xs">Conflict Resolution</Label>
              <Select
                value={config.conflict_resolution ?? 'newest-wins'}
                onValueChange={(value) =>
                  updateIntegrationConfig(plugin.name, 'conflict_resolution', value)
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest-wins">Newest wins</SelectItem>
                  <SelectItem value="sudocode-wins">Sudocode wins</SelectItem>
                  <SelectItem value="external-wins">External wins</SelectItem>
                  <SelectItem value="manual">Manual resolution</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                How to resolve conflicts when both sides are modified
              </p>
            </div>

            {/* Sync Direction */}
            <div className="space-y-1">
              <Label className="text-xs">Default Sync Direction</Label>
              <Select
                value={config.default_sync_direction ?? 'bidirectional'}
                onValueChange={(value) =>
                  updateIntegrationConfig(plugin.name, 'default_sync_direction', value)
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bidirectional">Bidirectional</SelectItem>
                  <SelectItem value="inbound">Inbound only (external → sudocode)</SelectItem>
                  <SelectItem value="outbound">Outbound only (sudocode → external)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Default sync direction for newly linked issues
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleSaveOptions(plugin.name)}
            disabled={savingPlugin === plugin.name}
          >
            {savingPlugin === plugin.name ? 'Saving...' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleTestPlugin(plugin.name)}
            disabled={testingPlugin === plugin.name}
          >
            {testingPlugin === plugin.name ? (
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            Test Connection
          </Button>
          {/* Only show Sync Now for plugins that support real-time sync */}
          {(plugin.capabilities?.supportsWatch || plugin.capabilities?.supportsPolling) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSyncPlugin(plugin.name)}
              disabled={syncingPlugin === plugin.name || !plugin.enabled}
              title={
                !plugin.enabled
                  ? 'Enable the plugin to sync'
                  : 'Import all entities from external system'
              }
            >
              {syncingPlugin === plugin.name ? (
                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Sync Now
            </Button>
          )}
        </div>

        {testResults[plugin.name] && (
          <div
            className={cn(
              'flex items-center gap-2 rounded p-2 text-xs',
              testResults[plugin.name].success
                ? 'bg-green-500/10 text-green-500'
                : 'bg-destructive/10 text-destructive'
            )}
          >
            {testResults[plugin.name].success ? (
              <Check className="h-3 w-3" />
            ) : (
              <X className="h-3 w-3" />
            )}
            {testResults[plugin.name].success
              ? 'Connection successful'
              : testResults[plugin.name].error || 'Connection failed'}
          </div>
        )}
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Left Navigation Sidebar */}
          <nav className="hidden w-48 shrink-0 flex-col border-r bg-muted/30 py-4 md:flex">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveTab(section.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                  'hover:bg-muted/50',
                  activeTab === section.id
                    ? 'border-r-2 border-primary bg-muted font-medium text-foreground'
                    : 'text-muted-foreground'
                )}
              >
                {section.icon}
                <span>{section.label}</span>
              </button>
            ))}
          </nav>

          {/* Mobile Navigation (dropdown style) */}
          <div className="border-b px-4 pb-4 pt-4 md:hidden">
            <Select value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTIONS.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    <div className="flex items-center gap-2">
                      {section.icon}
                      <span>{section.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Content Area */}
          <div
            className="flex-1 overflow-y-auto px-6 py-4"
            style={{ maxHeight: 'calc(85vh - 140px)' }}
          >
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Theme Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Palette className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Appearance</h3>
                  </div>

                  {/* Mode and Theme Selection - inline */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-sm text-muted-foreground">Theme</span>
                      <p className="text-xs text-muted-foreground/70">
                        {actualMode === 'dark' ? 'Dark mode theme' : 'Light mode theme'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Mode Selector */}
                      <Select
                        value={mode}
                        onValueChange={(value) => setMode(value as 'light' | 'dark' | 'system')}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system">
                            <div className="flex items-center gap-2">
                              <Monitor className="h-4 w-4" />
                              System
                            </div>
                          </SelectItem>
                          <SelectItem value="light">
                            <div className="flex items-center gap-2">
                              <Sun className="h-4 w-4" />
                              Light
                            </div>
                          </SelectItem>
                          <SelectItem value="dark">
                            <div className="flex items-center gap-2">
                              <Moon className="h-4 w-4" />
                              Dark
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Theme Selector - based on active mode */}
                      {actualMode === 'dark' ? (
                        <Select value={darkTheme.id} onValueChange={setDarkTheme}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availableDarkThemes.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex items-center gap-2">
                                  <ThemePreviewSwatch theme={t} />
                                  {t.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Select value={lightTheme.id} onValueChange={setLightTheme}>
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availableLightThemes.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                <div className="flex items-center gap-2">
                                  <ThemePreviewSwatch theme={t} />
                                  {t.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </div>

                {/* Version Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Version</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">CLI</span>
                      <span className="font-mono text-sm text-foreground">
                        {versions?.cli ?? 'Loading...'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Server</span>
                      <span className="font-mono text-sm text-foreground">
                        {versions?.server ?? 'Loading...'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Frontend</span>
                      <span className="font-mono text-sm text-foreground">
                        {versions?.frontend ?? 'Loading...'}
                      </span>
                    </div>

                    {/* Update Available - inline */}
                    {updateInfo?.updateAvailable && (
                      <div className="flex items-center justify-between rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium">Update available:</span>
                          <span className="font-mono text-sm font-medium">
                            {updateInfo.current}
                          </span>
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-sm text-orange-500">
                            {updateInfo.latest}
                          </span>
                        </div>
                        {restartServer.restartState !== 'idle' ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            <span>Restarting...</span>
                          </div>
                        ) : updateSuccess ? (
                          <Button
                            size="xs"
                            variant="default"
                            onClick={() => restartServer.handleRestart()}
                          >
                            <RotateCcw className="mr-1 h-3 w-3" />
                            Restart
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="default"
                            onClick={async () => {
                              try {
                                await installUpdate.mutateAsync()
                                setUpdateSuccess(true)
                                toast.success('Update installed successfully')
                              } catch (error) {
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : 'Failed to install update'
                                )
                              }
                            }}
                            disabled={installUpdate.isPending}
                          >
                            {installUpdate.isPending ? (
                              <>
                                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                                Updating...
                              </>
                            ) : (
                              'Update'
                            )}
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Error message */}
                    {installUpdate.isError && (
                      <div className="pt-1 text-xs text-destructive">
                        Update failed. Run: npm install -g sudocode@latest
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'voice' && (
              <div className="space-y-6">
                {/* Section Header */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Mic className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Voice Input</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Configure voice input settings for speech-to-text transcription.
                  </p>
                </div>

                {loadingVoice ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Enable Voice */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Enable Voice Input</Label>
                        <p className="text-xs text-muted-foreground">
                          Show the voice input button in the execution panel
                        </p>
                      </div>
                      <Switch
                        checked={voiceSettings.enabled !== false}
                        onCheckedChange={(checked) => updateVoiceSettings({ enabled: checked })}
                      />
                    </div>

                    {/* STT Settings - only show when voice is enabled */}
                    {voiceSettings.enabled !== false && (
                      <div className="space-y-4 border-t border-border pt-4">
                        <h4 className="text-sm font-medium">Speech-to-Text Settings</h4>

                        {/* STT Provider */}
                        <div className="space-y-1">
                          <Label className="text-xs">Provider</Label>
                          <Select
                            value={voiceSettings.stt?.provider || 'whisper-local'}
                            onValueChange={(value) =>
                              updateVoiceSTTSettings({
                                provider: value as 'whisper-local' | 'openai',
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="whisper-local">
                                Whisper (Local) - Self-hosted
                              </SelectItem>
                              <SelectItem value="openai" disabled>
                                OpenAI Whisper (Coming soon)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">
                            Falls back to browser Web Speech API if provider is unavailable
                          </p>
                        </div>

                        {/* Whisper URL - only show for whisper-local */}
                        {(!voiceSettings.stt?.provider ||
                          voiceSettings.stt?.provider === 'whisper-local') && (
                          <>
                            <div className="space-y-1">
                              <Label className="text-xs">Whisper Server URL</Label>
                              <Input
                                value={voiceSettings.stt?.whisperUrl || ''}
                                onChange={(e) =>
                                  updateVoiceSTTSettings({ whisperUrl: e.target.value })
                                }
                                placeholder="http://localhost:2022/v1"
                                className="h-8 text-sm"
                              />
                              <p className="text-[10px] text-muted-foreground">
                                URL of your local Whisper server (default: http://localhost:2022/v1)
                              </p>
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs">Whisper Model</Label>
                              <Select
                                value={voiceSettings.stt?.whisperModel || 'base'}
                                onValueChange={(value) =>
                                  updateVoiceSTTSettings({ whisperModel: value })
                                }
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="tiny">tiny (fastest, least accurate)</SelectItem>
                                  <SelectItem value="base">base (balanced)</SelectItem>
                                  <SelectItem value="small">small (better accuracy)</SelectItem>
                                  <SelectItem value="medium">medium (high accuracy)</SelectItem>
                                  <SelectItem value="large">large (best accuracy, slowest)</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-[10px] text-muted-foreground">
                                Whisper model to use for transcription
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Auto-save indicator */}
                    {savingVoice && (
                      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        <span>Saving...</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Voice Narration Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Voice Narration</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Configure text-to-speech settings for execution narration.
                  </p>
                </div>

                <div className="space-y-6">
                  {/* Enable Narration */}
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Enable Voice Narration</Label>
                      <p className="text-xs text-muted-foreground">
                        Speak execution progress and status updates aloud
                      </p>
                    </div>
                    <Switch
                      checked={voiceSettings.narration?.enabled === true}
                      onCheckedChange={(checked) =>
                        updateVoiceNarrationSettings({ enabled: checked })
                      }
                    />
                  </div>

                  {/* TTS Settings - only show when narration is enabled */}
                  {voiceSettings.narration?.enabled && (
                    <div className="space-y-4 border-t border-border pt-4">
                      <h4 className="text-sm font-medium">Text-to-Speech Settings</h4>

                      {/* TTS Provider Selection */}
                      <div className="space-y-1">
                        <Label className="text-xs">TTS Provider</Label>
                        <Select
                          value={voiceSettings.tts?.provider || 'browser'}
                          onValueChange={(value) =>
                            updateVoiceTTSSettings({ provider: value as 'browser' | 'kokoro' | 'openai' })
                          }
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="browser">Browser (Web Speech API)</SelectItem>
                            <SelectItem value="kokoro">Kokoro (High Quality, Local)</SelectItem>
                            <SelectItem value="openai" disabled>OpenAI (Coming soon)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground">
                          {voiceSettings.tts?.provider === 'kokoro'
                            ? 'High-quality 82M parameter model running in your browser'
                            : 'Uses your browser\'s built-in speech synthesis'}
                        </p>
                      </div>

                      {/* Kokoro Model Status - only show when Kokoro is selected */}
                      {voiceSettings.tts?.provider === 'kokoro' && (
                        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Kokoro Model</Label>
                            {kokoroTTS.status === 'ready' ? (
                              <span className="flex items-center gap-1 text-xs text-green-500">
                                <CheckCircle2 className="h-3 w-3" />
                                Ready
                              </span>
                            ) : kokoroTTS.status === 'error' ? (
                              <span className="flex items-center gap-1 text-xs text-destructive">
                                <AlertCircle className="h-3 w-3" />
                                Error
                              </span>
                            ) : kokoroTTS.status === 'loading' ? (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <RefreshCw className="h-3 w-3 animate-spin" />
                                Loading...
                              </span>
                            ) : null}
                          </div>

                          {kokoroTTS.status === 'idle' && (
                            <div className="space-y-2">
                              <p className="text-[10px] text-muted-foreground">
                                The Kokoro model (~86 MB) will be downloaded and cached in your browser.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => kokoroTTS.load()}
                                className="w-full"
                              >
                                <Download className="mr-2 h-3 w-3" />
                                Load Model (~86 MB)
                              </Button>
                            </div>
                          )}

                          {kokoroTTS.status === 'loading' && (
                            <div className="space-y-2">
                              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full bg-primary transition-all duration-300"
                                  style={{ width: `${kokoroTTS.progress}%` }}
                                />
                              </div>
                              <p className="text-center text-[10px] text-muted-foreground">
                                Downloading... {kokoroTTS.progress}%
                              </p>
                            </div>
                          )}

                          {kokoroTTS.status === 'error' && (
                            <div className="space-y-2">
                              <p className="text-[10px] text-destructive">
                                {kokoroTTS.error || 'Failed to load model'}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => kokoroTTS.load()}
                                className="w-full"
                              >
                                <RefreshCw className="mr-2 h-3 w-3" />
                                Retry
                              </Button>
                            </div>
                          )}

                          {kokoroTTS.status === 'ready' && (
                            <p className="text-[10px] text-muted-foreground">
                              Model loaded and ready. Cached for faster loading next time.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Voice Selection - different options based on provider */}
                      <div className="space-y-1">
                        <Label className="text-xs">Voice</Label>
                        {voiceSettings.tts?.provider === 'kokoro' ? (
                          <>
                            <Select
                              value={voiceSettings.tts?.defaultVoice || 'af_heart'}
                              onValueChange={(value) =>
                                updateVoiceTTSSettings({ defaultVoice: value })
                              }
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="Select a voice" />
                              </SelectTrigger>
                              <SelectContent>
                                {getKokoroVoices().map((voice) => (
                                  <SelectItem key={voice.id} value={voice.id}>
                                    {voice.name} ({voice.gender}, {voice.language})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-muted-foreground">
                              High-quality Kokoro voice
                            </p>
                          </>
                        ) : (
                          <>
                            <Select
                              value={voiceSettings.narration?.voice || 'default'}
                              onValueChange={(value) =>
                                updateVoiceNarrationSettings({ voice: value === 'default' ? '' : value })
                              }
                            >
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder="System default" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">System default</SelectItem>
                                {availableVoices
                                  .filter((v) => v.lang.startsWith('en'))
                                  .slice(0, 20)
                                  .map((voice) => (
                                    <SelectItem key={voice.voiceURI} value={voice.name}>
                                      {voice.name} ({voice.lang})
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[10px] text-muted-foreground">
                              Browser Web Speech API voice
                            </p>
                          </>
                        )}
                      </div>

                      {/* Speech Rate */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Speech Speed</Label>
                          <span className="text-xs text-muted-foreground">
                            {(voiceSettings.narration?.speed ?? 1.0).toFixed(1)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.1"
                          value={voiceSettings.narration?.speed ?? 1.0}
                          onChange={(e) =>
                            updateVoiceNarrationSettings({ speed: parseFloat(e.target.value) })
                          }
                          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>0.5x (Slow)</span>
                          <span>2.0x (Fast)</span>
                        </div>
                      </div>

                      {/* Volume */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Volume</Label>
                          <span className="text-xs text-muted-foreground">
                            {Math.round((voiceSettings.narration?.volume ?? 1.0) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={voiceSettings.narration?.volume ?? 1.0}
                          onChange={(e) =>
                            updateVoiceNarrationSettings({ volume: parseFloat(e.target.value) })
                          }
                          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>0%</span>
                          <span>100%</span>
                        </div>
                      </div>

                      {/* Test Button */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={voiceSettings.tts?.provider === 'kokoro' && kokoroTTS.isPlaying}
                        onClick={async () => {
                          const testText = 'Voice narration is working correctly.'

                          if (voiceSettings.tts?.provider === 'kokoro') {
                            // Use Kokoro TTS
                            try {
                              await kokoroTTS.speak(testText, {
                                voice: voiceSettings.tts?.defaultVoice || 'af_heart',
                                speed: voiceSettings.narration?.speed ?? 1.0,
                              })
                            } catch (err) {
                              toast.error('Failed to test Kokoro narration', {
                                description: err instanceof Error ? err.message : 'Unknown error',
                              })
                            }
                          } else if ('speechSynthesis' in window) {
                            // Use browser Web Speech API
                            const utterance = new SpeechSynthesisUtterance(testText)
                            utterance.rate = voiceSettings.narration?.speed ?? 1.0
                            utterance.volume = voiceSettings.narration?.volume ?? 1.0
                            if (voiceSettings.narration?.voice) {
                              const voice = availableVoices.find(
                                (v) => v.name === voiceSettings.narration?.voice
                              )
                              if (voice) utterance.voice = voice
                            }
                            window.speechSynthesis.speak(utterance)
                          }
                        }}
                      >
                        {kokoroTTS.isPlaying ? 'Playing...' : 'Test Narration'}
                      </Button>

                      {/* Narration Content Settings */}
                      <div className="mt-4 space-y-3 border-t border-border pt-4">
                        <h4 className="text-sm font-medium">Narration Content</h4>
                        <p className="text-[10px] text-muted-foreground">
                          Choose what execution events are spoken aloud
                        </p>

                        {/* Narrate Tool Use */}
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs">Narrate tool actions</Label>
                            <p className="text-[10px] text-muted-foreground">
                              Read, Write, Bash, Grep, etc.
                            </p>
                          </div>
                          <Switch
                            checked={voiceSettings.narration?.narrateToolUse !== false}
                            onCheckedChange={(checked) =>
                              updateVoiceNarrationSettings({ narrateToolUse: checked })
                            }
                          />
                        </div>

                        {/* Narrate Tool Results */}
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs">Narrate tool results</Label>
                            <p className="text-[10px] text-muted-foreground">
                              Announce when tools complete
                            </p>
                          </div>
                          <Switch
                            checked={voiceSettings.narration?.narrateToolResults === true}
                            onCheckedChange={(checked) =>
                              updateVoiceNarrationSettings({ narrateToolResults: checked })
                            }
                          />
                        </div>

                        {/* Narrate Assistant Messages */}
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label className="text-xs">Narrate agent responses</Label>
                            <p className="text-[10px] text-muted-foreground">
                              Speak the agent&apos;s text messages
                            </p>
                          </div>
                          <Switch
                            checked={voiceSettings.narration?.narrateAssistantMessages !== false}
                            onCheckedChange={(checked) =>
                              updateVoiceNarrationSettings({ narrateAssistantMessages: checked })
                            }
                          />
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'integrations' && (
              <div className="space-y-6">
                {/* Section Header */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Plug className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Integrations</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Configure integrations with external issue tracking systems.
                  </p>
                </div>

                {/* Install plugin dropdown */}
                <div className="flex items-center gap-2">
                  <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                    <SelectTrigger className="h-8 flex-1">
                      <SelectValue placeholder="Select a plugin to install..." />
                    </SelectTrigger>
                    <SelectContent>
                      {presetPlugins.map((preset) => (
                        <SelectItem
                          key={preset.name}
                          value={preset.name}
                          disabled={plugins.some((p) => p.name === preset.name && p.installed)}
                        >
                          {preset.displayName}
                          {plugins.some((p) => p.name === preset.name && p.installed) && (
                            <span className="ml-2 text-xs text-muted-foreground">(installed)</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleInstallPlugin}
                    disabled={!selectedPreset || installing}
                    className="h-8"
                  >
                    {installing ? (
                      <>
                        <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                        Installing...
                      </>
                    ) : (
                      'Install'
                    )}
                  </Button>
                </div>

                {loadingPlugins ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : plugins.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <Plug className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    <p className="text-sm">No plugins available</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {plugins.map((plugin) => (
                      <div key={plugin.name} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {plugin.displayName || plugin.name}
                                </span>
                                {plugin.version && (
                                  <span className="text-xs text-muted-foreground">
                                    v{plugin.version}
                                  </span>
                                )}
                                {!plugin.installed && (
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                    Available
                                  </span>
                                )}
                              </div>
                              {plugin.description && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {plugin.description}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {plugin.installed && (
                              <>
                                <Switch
                                  checked={plugin.enabled}
                                  onCheckedChange={() => handleTogglePlugin(plugin)}
                                />
                                <button
                                  onClick={() =>
                                    setExpandedPlugin(
                                      expandedPlugin === plugin.name ? null : plugin.name
                                    )
                                  }
                                  className="rounded p-1 hover:bg-accent"
                                >
                                  {expandedPlugin === plugin.name ? (
                                    <ChevronUp className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {expandedPlugin === plugin.name &&
                          plugin.installed &&
                          renderPluginConfig(plugin)}

                        {!plugin.installed && (
                          <div className="mt-3 border-t border-border pt-3">
                            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                              <Terminal className="h-3 w-3" />
                              <span>Install via npm:</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 rounded bg-muted px-2 py-1.5 font-mono text-xs">
                                npm install {plugin.package}
                              </code>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2"
                                onClick={() => copyInstallCommand(plugin.name, plugin.package)}
                              >
                                {copiedCommand === plugin.name ? (
                                  <Check className="h-3 w-3 text-green-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                            <p className="mt-2 text-[10px] text-muted-foreground">
                              After installing, restart the server to activate the plugin.
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
