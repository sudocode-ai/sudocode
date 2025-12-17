import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTheme } from '@/contexts/ThemeContext'
import {
  Sun,
  Moon,
  Plug,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Copy,
  Terminal,
  Settings2,
} from 'lucide-react'
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

type SettingsTab = 'general' | 'integrations'

// Section configuration for sidebar navigation
interface Section {
  id: SettingsTab
  label: string
  icon: React.ReactNode
}

const SECTIONS: Section[] = [
  { id: 'general', label: 'General', icon: <Settings2 className="h-4 w-4" /> },
  { id: 'integrations', label: 'Integrations', icon: <Plug className="h-4 w-4" /> },
]

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
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

  // Preset plugins available for installation
  const presetPlugins = [
    { name: 'beads', package: '@sudocode-ai/integration-beads', displayName: 'Beads' },
  ]

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

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
        { message: string; alreadyInstalled?: boolean },
        { message: string; alreadyInstalled?: boolean }
      >(`/plugins/${preset.name}/install`, { package: preset.package })

      if (result?.alreadyInstalled) {
        toast.info(`${preset.displayName} is already installed`)
      } else {
        toast.success(`${preset.displayName} installed successfully`)
      }
      // Refresh plugins list
      const data = await api.get<{ plugins: PluginInfo[] }, { plugins: PluginInfo[] }>('/plugins')
      setPlugins(data.plugins)
      // Initialize options for newly installed plugin
      const newPlugin = data.plugins.find((p) => p.name === preset.name)
      if (newPlugin) {
        setPluginOptions((prev) => ({
          ...prev,
          [preset.name]: newPlugin.options || {},
        }))
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
        {/* Plugin-specific options */}
        {plugin.configSchema?.properties && (
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

        {/* Integration-level settings */}
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
                    <Sun className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-base font-semibold">Appearance</h3>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Theme</span>
                    <button
                      onClick={toggleTheme}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        'bg-accent text-foreground hover:bg-accent/80'
                      )}
                    >
                      {theme === 'dark' ? (
                        <>
                          <Sun className="h-4 w-4" />
                          <span>Light Mode</span>
                        </>
                      ) : (
                        <>
                          <Moon className="h-4 w-4" />
                          <span>Dark Mode</span>
                        </>
                      )}
                    </button>
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
                  </div>
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
