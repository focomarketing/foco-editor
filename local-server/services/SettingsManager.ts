import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  transcriptionProvider: 'local' | 'openai' | 'groq';
  aiProvider: 'claude' | 'openai' | 'codez';
  apiKeys: {
    openai?: string;
    claude?: string;
    groq?: string;
    codez?: string; // Ex: Uma API customizada ou outro provedor
  };
  localWhisperPath?: string; // Caminho para o binário do whisper.cpp se necessário
}

const DEFAULT_SETTINGS: AppSettings = {
  transcriptionProvider: 'local',
  aiProvider: 'claude',
  apiKeys: {},
};

export class SettingsManager {
  private static settingsFilePath = path.join(process.cwd(), 'app-settings.json');
  private static currentSettings: AppSettings | null = null;

  static getSettings(): AppSettings {
    if (this.currentSettings) return this.currentSettings;

    try {
      if (fs.existsSync(this.settingsFilePath)) {
        const data = fs.readFileSync(this.settingsFilePath, 'utf-8');
        this.currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      } else {
        this.currentSettings = DEFAULT_SETTINGS;
      }
    } catch (e) {
      console.error('Erro ao ler configurações', e);
      this.currentSettings = DEFAULT_SETTINGS;
    }

    return this.currentSettings!;
  }

  static saveSettings(newSettings: Partial<AppSettings>) {
    this.currentSettings = { ...this.getSettings(), ...newSettings };
    fs.writeFileSync(this.settingsFilePath, JSON.stringify(this.currentSettings, null, 2), 'utf-8');
  }
}
