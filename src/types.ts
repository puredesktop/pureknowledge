export interface ShellPreferences {
  workingDirectory: string
  theme: 'light' | 'dark'
}

export interface KnowledgeAppSettings {
  storePath?: string
  activeSpaceId?: string
  activePageId?: string
}

export interface PlatformAppSettingsUpdateRequest {
  appSlug: string
  patch: Record<string, unknown>
}

export interface KnowledgeBootState {
  organisation?: {id:string;folder:string}|null
  prefs: ShellPreferences
  appSettings: KnowledgeAppSettings
}
