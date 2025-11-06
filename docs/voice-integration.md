# Voice Dictation Integration Specification

## Overview

This specification describes the integration of browser-based voice input/output capabilities into the sudocode web UI. The implementation enables hands-free interaction with AI agents through speech-to-text (STT) and text-to-speech (TTS) using the Web Speech API.

## Motivation

Voice dictation provides:
- **Hands-free operation**: Users can interact with agents while working on other tasks
- **Accessibility**: Improved accessibility for users who prefer or require voice input
- **Natural interaction**: More conversational interaction with AI agents
- **Multi-tasking**: Monitor agent progress through audio feedback while context-switching

## Design Principles

1. **Browser-Native**: Use Web Speech API (no external dependencies or API keys)
2. **Optional & Toggleable**: Voice features are opt-in and can be enabled/disabled per execution
3. **Graceful Degradation**: Full functionality when browser support is unavailable
4. **Multi-Agent Aware**: Intelligent TTS consolidation when multiple executions are active
5. **Real-time Streaming**: Seamlessly integrates with existing SSE architecture

## Inspiration

This design is inspired by [mcp-voice-hooks](https://github.com/johnmatthewtennant/mcp-voice-hooks), which demonstrates voice integration for Claude Code using browser TTS/STT and MCP hooks.

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser Layer                         │
├─────────────────────────────────────────────────────────────┤
│  VoiceControls UI ← → VoiceService ← → Web Speech API      │
│         ↓                  ↓                                 │
│   useVoiceInput Hook   VoiceContext (Global State)         │
└─────────────────┬───────────────────────────┬───────────────┘
                  ↓                           ↓
            WebSocket (voice input)    SSE (TTS events)
                  ↓                           ↑
┌─────────────────┴───────────────────────────┴───────────────┐
│                       Server Layer                           │
├─────────────────────────────────────────────────────────────┤
│  VoiceTransport ← → VoiceConsolidationService              │
│         ↓                       ↑                            │
│  TransportManager  ← → VoiceEventAdapter                    │
│         ↓                       ↑                            │
│  ExecutionService ← → AgUiEventAdapter                      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Voice Input Flow (Speech-to-Text)
```
User speaks
  ↓
Browser SpeechRecognition API
  ↓
VoiceService processes transcript
  ↓
useVoiceInput hook creates VoiceEvent
  ↓
WebSocket sends to server
  ↓
VoiceTransport receives and routes
  ↓
ExecutionService injects as user input
  ↓
LinearOrchestrator processes
  ↓
Agent receives and responds
```

#### Voice Output Flow (Text-to-Speech)
```
Agent generates text message
  ↓
AgUiEventAdapter emits event
  ↓
VoiceEventAdapter transforms to VoiceEvent
  ↓
VoiceConsolidationService processes
  ↓ (if multiple agents active)
Applies priority/queue logic
  ↓
Broadcast via SSE to frontend
  ↓
VoiceService receives and queues
  ↓
Browser SpeechSynthesis speaks
```

## Component Specifications

### Frontend Components

#### 1. VoiceService (`/frontend/src/services/voice-service.ts`)

Core service wrapping Web Speech API functionality.

**Responsibilities:**
- Initialize and manage SpeechRecognition instance
- Manage SpeechSynthesis utterance queue
- Handle browser compatibility detection
- Emit events for voice state changes

**API:**
```typescript
class VoiceService {
  // Initialization
  constructor()
  isSupported(): boolean

  // Speech Recognition (Input)
  startListening(): Promise<void>
  stopListening(): void
  pauseListening(): void
  resumeListening(): void

  // Speech Synthesis (Output)
  speak(text: string, options?: SpeechOptions): Promise<void>
  stopSpeaking(): void
  pauseSpeaking(): void
  resumeSpeaking(): void
  getAvailableVoices(): SpeechSynthesisVoice[]

  // State
  isListening: boolean
  isSpeaking: boolean

  // Events
  on(event: 'transcript' | 'error' | 'status', handler: Function): void
  off(event: string, handler: Function): void
}
```

#### 2. VoiceControls Component (`/frontend/src/components/executions/VoiceControls.tsx`)

UI component for voice feature controls.

**Features:**
- Toggle voice input on/off
- Toggle voice output on/off
- Microphone status indicator (idle/listening/processing)
- Real-time transcript display
- Voice selection dropdown
- Audio level visualization (optional)

**Props:**
```typescript
interface VoiceControlsProps {
  executionId: string
  onVoiceInput?: (transcript: string) => void
  disabled?: boolean
}
```

#### 3. useVoiceInput Hook (`/frontend/src/hooks/useVoiceInput.ts`)

React hook for managing voice state in execution context.

**API:**
```typescript
function useVoiceInput(executionId: string) {
  return {
    isEnabled: boolean
    isListening: boolean
    isSpeaking: boolean
    transcript: string
    error: string | null

    toggleVoiceInput: () => void
    toggleVoiceOutput: () => void
    startListening: () => Promise<void>
    stopListening: () => void

    config: VoiceConfig
    updateConfig: (config: Partial<VoiceConfig>) => void
  }
}
```

#### 4. VoiceContext (`/frontend/src/contexts/VoiceContext.tsx`)

Global context for voice state management and TTS consolidation.

**Responsibilities:**
- Track all voice-enabled executions
- Coordinate TTS across multiple executions
- Prevent overlapping speech
- Manage global voice service instance

**API:**
```typescript
interface VoiceContextValue {
  // Global voice service
  voiceService: VoiceService

  // Execution tracking
  enabledExecutions: Set<string>
  currentlySpeaking: string | null

  // Registration
  registerExecution(id: string, config: VoiceConfig): void
  unregisterExecution(id: string): void

  // TTS queue management
  enqueueSpeech(executionId: string, text: string, priority: Priority): void
}
```

### Backend Components

#### 5. VoiceTransport (`/server/src/execution/transport/voice-transport.ts`)

WebSocket handler for bidirectional voice events.

**Responsibilities:**
- Establish WebSocket connections for voice
- Route incoming voice input to appropriate execution
- Broadcast TTS events to connected clients
- Handle connection lifecycle

**API:**
```typescript
class VoiceTransport {
  constructor(consolidationService: VoiceConsolidationService)

  // Connection management
  handleConnection(clientId: string, ws: WebSocket): void
  handleDisconnect(clientId: string): void

  // Event routing
  handleVoiceInput(clientId: string, event: VoiceEvent): void
  broadcastVoiceOutput(executionId: string, event: VoiceEvent): void

  // State
  getConnectedClients(executionId?: string): ClientConnection[]
}
```

#### 6. VoiceEventAdapter (`/server/src/execution/output/voice-event-adapter.ts`)

Transforms agent output into voice events.

**Responsibilities:**
- Filter which messages should be spoken
- Split long messages into utterance chunks
- Determine message priority
- Transform AgUiEvents to VoiceEvents

**API:**
```typescript
class VoiceEventAdapter {
  constructor(config: VoiceAdapterConfig)

  // Event transformation
  processAgUiEvent(event: AgUiEvent): VoiceEvent[]

  // Configuration
  shouldSpeak(event: AgUiEvent): boolean
  splitMessage(text: string, maxLength: number): string[]
  determinePriority(event: AgUiEvent): Priority
}
```

#### 7. VoiceConsolidationService (`/server/src/services/voice-consolidation-service.ts`)

Manages TTS coordination across multiple executions.

**Responsibilities:**
- Track active voice-enabled executions
- Queue TTS events by priority
- Prevent overlapping speech
- Handle interruption logic

**API:**
```typescript
class VoiceConsolidationService {
  // Execution tracking
  registerExecution(id: string, config: VoiceConfig): void
  unregisterExecution(id: string): void

  // TTS queue management
  enqueue(executionId: string, event: VoiceOutputData): void
  interrupt(executionId: string): void
  onUtteranceEnd(executionId: string): void

  // State
  getActiveExecutions(): string[]
  getCurrentlySpeaking(): string | null
  getQueueLength(): number
}
```

### Type Definitions

#### Voice Types (`/types/src/voice.ts`)

```typescript
export interface VoiceConfig {
  enabled: boolean
  inputEnabled: boolean
  outputEnabled: boolean
  voiceName?: string
  rate?: number          // 0.1-10, default 1
  pitch?: number         // 0-2, default 1
  volume?: number        // 0-1, default 1
  autoSpeak?: boolean
  interruptOnInput?: boolean
}

export interface VoiceEvent {
  type: 'voice_input' | 'voice_output' | 'voice_status'
  executionId: string
  timestamp: string
  data: VoiceInputData | VoiceOutputData | VoiceStatusData
}

export interface VoiceInputData {
  transcript: string
  confidence: number
  isFinal: boolean
  interim?: string
}

export interface VoiceOutputData {
  text: string
  priority: 'high' | 'normal' | 'low'
  interrupt?: boolean
  chunkIndex?: number
  totalChunks?: number
}

export interface VoiceStatusData {
  status: 'listening' | 'speaking' | 'idle' | 'error'
  message?: string
}

export type Priority = 'high' | 'normal' | 'low'

export interface SpeechOptions {
  voice?: SpeechSynthesisVoice
  rate?: number
  pitch?: number
  volume?: number
}
```

#### Extended Execution Types

```typescript
// Add to ExecutionConfig in /types/src/execution.ts
export interface ExecutionConfig {
  // ... existing fields
  voice?: VoiceConfig
}

// Add to AgUiEvent union
export type AgUiEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | VoiceEvent  // New
```

## Browser Compatibility

### Support Matrix

| Feature | Chrome | Safari | Firefox | Edge |
|---------|--------|--------|---------|------|
| Speech Recognition | ✅ 25+ | ✅ 14.1+ | ❌ | ✅ 79+ |
| Speech Synthesis | ✅ 33+ | ✅ 7+ | ✅ 49+ | ✅ 14+ |

### Detection Strategy

```typescript
function detectVoiceSupport() {
  return {
    recognition: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
    synthesis: 'speechSynthesis' in window,
    fullSupport: recognition && synthesis
  }
}
```

### Fallback Behavior

When voice features are unsupported:
1. Display informative message in VoiceControls
2. Disable voice toggle buttons
3. Hide voice-related UI elements
4. Continue normal text-based operation
5. Log warning in console for debugging

## Security & Privacy

### Permissions
- Browser requests microphone permission on first use
- Permission is per-origin (sudocode web UI domain)
- User can revoke permission at any time via browser settings

### Data Handling
- Voice transcripts are treated as user input (same security as text input)
- No audio recordings are stored on server
- Only text transcripts are transmitted over WebSocket
- All communication uses existing authentication

### Privacy
- Speech recognition happens in browser (no cloud API)
- Transcripts are ephemeral (not persisted unless part of execution log)
- Users control when microphone is active
- Clear visual indicators when listening

## Configuration

### Execution-Level Configuration

Added to ExecutionConfigDialog:

```typescript
<VoiceSettings>
  <Switch
    label="Enable Voice Input"
    checked={config.voice?.inputEnabled}
    onChange={(enabled) => updateVoiceConfig({ inputEnabled: enabled })}
  />
  <Switch
    label="Enable Voice Output"
    checked={config.voice?.outputEnabled}
    onChange={(enabled) => updateVoiceConfig({ outputEnabled: enabled })}
  />
  <Select
    label="Voice"
    options={availableVoices}
    value={config.voice?.voiceName}
    onChange={(voice) => updateVoiceConfig({ voiceName: voice })}
  />
  <Slider
    label="Speech Rate"
    min={0.5}
    max={2}
    step={0.1}
    value={config.voice?.rate ?? 1}
    onChange={(rate) => updateVoiceConfig({ rate })}
  />
  <Slider
    label="Pitch"
    min={0}
    max={2}
    step={0.1}
    value={config.voice?.pitch ?? 1}
    onChange={(pitch) => updateVoiceConfig({ pitch })}
  />
  <Switch
    label="Auto-speak agent messages"
    checked={config.voice?.autoSpeak}
    onChange={(enabled) => updateVoiceConfig({ autoSpeak: enabled })}
  />
  <Switch
    label="Interrupt on user input"
    checked={config.voice?.interruptOnInput}
    onChange={(enabled) => updateVoiceConfig({ interruptOnInput: enabled })}
  />
</VoiceSettings>
```

### Global User Preferences (Optional)

Store default voice preferences in localStorage:
- Default voice selection
- Default rate/pitch/volume
- Auto-enable for new executions

## TTS Consolidation Logic

### Priority System

1. **High**: User input acknowledgments, critical errors
2. **Normal**: Agent responses, status updates
3. **Low**: Background progress messages, debug info

### Queue Management

```typescript
class TtsQueue {
  // Queue structure: Array<{executionId, data, priority}>
  private queue: QueueItem[] = []
  private currentUtterance: QueueItem | null = null

  enqueue(item: QueueItem) {
    // High priority interrupts current speech
    if (item.priority === 'high' && this.currentUtterance) {
      this.interrupt()
    }

    // Insert by priority
    const insertIndex = this.findInsertIndex(item.priority)
    this.queue.splice(insertIndex, 0, item)

    // Start speaking if idle
    if (!this.currentUtterance) {
      this.processNext()
    }
  }

  interrupt() {
    if (this.currentUtterance) {
      speechSynthesis.cancel()
      this.currentUtterance = null
      this.processNext()
    }
  }

  onEnd() {
    this.currentUtterance = null
    this.processNext()
  }

  processNext() {
    if (this.queue.length > 0) {
      this.currentUtterance = this.queue.shift()
      this.speak(this.currentUtterance)
    }
  }
}
```

### Interrupt Rules

| Scenario | Behavior |
|----------|----------|
| High priority event arrives | Interrupt current, speak immediately |
| User speaks while agent speaking | Interrupt if `interruptOnInput` enabled |
| Multiple normal priority events | Queue in FIFO order |
| Same execution multiple messages | Queue sequentially |

## Implementation Phases

### Phase 1: Foundation (Types & Services)
**Duration**: 1-2 days

Tasks:
- [ ] Create voice type definitions in `/types/src/voice.ts`
- [ ] Extend ExecutionConfig with VoiceConfig
- [ ] Add VoiceEvent to AgUiEvent union
- [ ] Implement VoiceService in frontend
- [ ] Add browser compatibility detection
- [ ] Write unit tests for VoiceService

**Deliverables**:
- Type definitions
- Working VoiceService with Web Speech API
- Browser support detection

### Phase 2: Frontend UI
**Duration**: 2-3 days

Tasks:
- [ ] Create VoiceControls component
- [ ] Implement useVoiceInput hook
- [ ] Create VoiceContext provider
- [ ] Integrate into ExecutionView
- [ ] Add voice settings to ExecutionConfigDialog
- [ ] Style components with Tailwind

**Deliverables**:
- Functional voice UI components
- Integration with existing execution flow

### Phase 3: Backend Transport
**Duration**: 2-3 days

Tasks:
- [ ] Implement VoiceTransport for WebSocket
- [ ] Create VoiceEventAdapter
- [ ] Extend TransportManager
- [ ] Add voice routing to ExecutionService
- [ ] Update SSE broadcasting
- [ ] Write integration tests

**Deliverables**:
- Bidirectional voice event transport
- Voice event transformation pipeline

### Phase 4: Consolidation
**Duration**: 2-3 days

Tasks:
- [ ] Implement VoiceConsolidationService
- [ ] Add priority queue logic
- [ ] Implement interrupt handling
- [ ] Test with multiple concurrent executions
- [ ] Add consolidation metrics

**Deliverables**:
- Working TTS consolidation
- Multi-agent voice coordination

### Phase 5: Polish & Testing
**Duration**: 1-2 days

Tasks:
- [ ] Add visual feedback (waveform, transcript)
- [ ] Improve error handling and recovery
- [ ] Add comprehensive tests
- [ ] Browser compatibility testing
- [ ] Documentation updates
- [ ] Performance optimization

**Deliverables**:
- Production-ready voice features
- Complete test coverage
- Updated documentation

## Open Questions

### 1. Voice Input Triggering
**Options**:
- A) Always listening when enabled (auto-detect speech)
- B) Push-to-talk (hold button to speak)
- C) Click-to-toggle (click to start, click to stop)
- D) Wake word activated ("Hey Sudocode")

**Recommendation**: Start with option C (click-to-toggle) for simplicity and privacy. Can add option B as alternative mode.

### 2. TTS Filtering
**Question**: Which agent messages should be spoken?

**Options**:
- A) All text messages
- B) Only user-facing messages (exclude tool calls, internal state)
- C) Configurable filter by message type
- D) Smart filtering based on message content

**Recommendation**: Option B by default, with option C available in advanced settings.

### 3. Interrupt Behavior
**Question**: When should new speech interrupt current speech?

**Options**:
- A) Always on user input
- B) Only on high-priority messages
- C) Never (always queue)
- D) User-configurable per execution

**Recommendation**: Option A for user input, Option B for agent messages, with Option D as override.

### 4. Offline Support
**Question**: Should we support non-browser TTS/STT?

**Options**:
- A) Web Speech API only (browser-native)
- B) Optional system TTS fallback (macOS say, Windows SAPI)
- C) Cloud TTS services (Google, AWS, Azure)
- D) Multiple providers with fallback chain

**Recommendation**: Option A for MVP. Can add Option B for desktop app in future.

### 5. Voice Feedback Persistence
**Question**: Should voice transcripts be saved in execution logs?

**Options**:
- A) Yes, save all transcripts as part of execution history
- B) No, voice is ephemeral (like verbal conversation)
- C) User-configurable per execution
- D) Save only "final" transcripts (not interim results)

**Recommendation**: Option D - save final transcripts in execution logs for reproducibility.

## Success Metrics

### User Experience
- Voice input accuracy > 90% for clear speech
- TTS latency < 500ms from event to speech start
- UI responsiveness maintained during voice operations
- Zero crashes related to voice features

### Technical
- Browser compatibility > 80% of users
- WebSocket message overhead < 1KB per voice event
- TTS consolidation prevents overlap 99%+ of the time
- Voice feature toggle response < 100ms

### Adoption
- Track % of executions with voice enabled
- Measure average voice session duration
- Collect user feedback on voice quality
- Monitor microphone permission grant rate

## Future Enhancements

### Short-term (Next 3 months)
- Push-to-talk mode
- Audio level visualization
- Voice command shortcuts ("Stop", "Pause", "Repeat")
- Multi-language support

### Medium-term (3-6 months)
- Wake word detection
- Custom voice training
- Voice profiles (save voice preferences)
- Integration with desktop notifications

### Long-term (6+ months)
- Advanced noise cancellation
- Speaker identification (multi-user scenarios)
- Cloud TTS fallback for better quality
- Voice analytics and insights

## References

- [Web Speech API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [SpeechRecognition - MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [SpeechSynthesis - MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
- [MCP Voice Hooks](https://github.com/johnmatthewtennant/mcp-voice-hooks)
- [Browser Compatibility Data](https://caniuse.com/?search=speech)

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-06 | 0.1.0 | Initial specification |
