import { useState, useCallback, useEffect } from 'react';

// Settings storage key
const SETTINGS_STORAGE_KEY = 'bugsafari_settings';

// Default settings
export interface AppSettings {
  // Account
  fullName: string;
  username: string;
  email: string;
  
  // Application - Theme
  darkMode: boolean;
  lightMode: boolean;
  // Application - Features
  notifications: boolean;
  autoSave: boolean;
  
  // BugSafari
  scanSensitivity: 'low' | 'medium' | 'high';
  autoBugDetection: boolean;
  autoReportGeneration: boolean;
  aiAnalysis: boolean;
}

const defaultSettings: AppSettings = {
  fullName: '',
  username: '',
  email: '',
  darkMode: false,
  lightMode: true,
  notifications: true,
  autoSave: true,
  scanSensitivity: 'medium',
  autoBugDetection: true,
  autoReportGeneration: true,
  aiAnalysis: true,
};

// Load settings from localStorage
function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error('[useSettings] Failed to load settings:', error);
  }
  return defaultSettings;
}

// Save settings to localStorage
function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('[useSettings] Failed to save settings:', error);
  }
}

// Apply theme to document immediately
export function applyTheme(settings: AppSettings): void {
  const html = document.documentElement;
  
  if (settings.darkMode) {
    html.classList.add('dark');
    html.classList.remove('light');
  } else if (settings.lightMode) {
    html.classList.add('light');
    html.classList.remove('dark');
  } else {
    // Default to light mode
    html.classList.add('light');
    html.classList.remove('dark');
  }
}

/**
 * Custom hook for managing application settings
 * Persists settings to localStorage
 */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [isLoading, setIsLoading] = useState(false);

  // Save to localStorage whenever settings change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Update a single setting
  const updateSetting = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // Update multiple settings at once
  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  // Reset settings to defaults
  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
  }, []);

  // Load user data from stored auth
  const loadUserData = useCallback(() => {
    const storedUser = localStorage.getItem('bugsafari_user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setSettings(prev => ({
          ...prev,
          email: user.email || '',
          fullName: user.fullName || '',
          username: user.username || user.email?.split('@')[0] || '',
        }));
      } catch (error) {
        console.error('[useSettings] Failed to load user data:', error);
      }
    }
  }, []);

return {
    settings,
    isLoading,
    updateSetting,
    updateSettings,
    resetSettings,
    loadUserData,
  };
}
