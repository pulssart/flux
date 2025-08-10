import { useEffect, useState } from "react";

type Lang = "fr" | "en";
const STORAGE_KEY = "flux:lang";
const EVT = "flux:lang-change";

const DICT: Record<Lang, Record<string, string>> = {
  fr: {
    addUrlPlaceholder: "Ajouter une URL RSS…",
    add: "Ajouter",
    emptySidebar: "Ajoutez vos flux RSS pour commencer.",
    settings: "Réglages",
    appearanceAndLanguage: "Apparence et langue",
    theme: "Thème",
    light: "Light",
    dark: "Dark",
    system: "System",
    language: "Langue",
    french: "Français",
    english: "English",
    close: "Fermer",
    expandSidebar: "Déployer la sidebar",
    collapseSidebar: "Réduire la sidebar",
    rename: "Renommer le flux",
    remove: "Supprimer le flux",
    discoverError: "Impossible de trouver un flux pour cette URL (20s). Vérifiez l’adresse.",
    showAll: "Tous",
    todayOnly: "Aujourd'hui",
    refresh: "Recharger",
    sidebarFolders: "Dossiers",
    sidebarFeeds: "Flux",
    exportData: "Exporter",
    importData: "Importer",
    importInvalid: "Fichier d’import invalide",
    importSuccess: "Import terminé",
    exportReady: "Export prêt",
    noArticles: "Aucun article pour le moment.",
    noArticlesToday: "Aucun article pour aujourd'hui.",
    overview: "Aperçu",
    todayResume: "Résumé du jour",
    generateTodayResume: "Générer le résumé du jour",
    generatingResume: "Génération du résumé…",
    updateResume: "Mettre à jour",
    viewArticle: "Voir l’article",
    play: "Lire",
    generating: "Génération…",
    stop: "Stop",
    playDailyDigest: "Lire l'actualité du jour",
    copyLink: "Copier le lien",
    linkCopied: "Lien copié",
    playbackStarted: "Lecture du résumé en cours",
    dailySummaryFailed: "Échec du résumé du jour",
    clipboardError: "Impossible de copier le lien",
    loadError: "Erreur de chargement",
    noFeedDetected: "Aucun flux RSS détecté pour cette URL. Vérifie l’adresse ou essaie une autre page.",
    openAiMissing: "Clé OpenAI manquante. Ajoutez-la dans Réglages → Clé API OpenAI.",
    articleExtractFailed: "Échec d'extraction de l'article",
    serverGenError: "Erreur serveur lors de la génération",
    addFeed: "Ajouter un flux",
    addFolder: "Ajouter un dossier",
    settingsTooltip: "Réglages",
    playAudioSummary: "Lire le résumé audio",
    reorder: "Réorganiser",
    newFolder: "Nouveau dossier",
    verifying: "Vérification…",
    relaunchOnboarding: "Relancer l’onboarding",
    openAiKeyLabel: "Clé API OpenAI (GPT-5 / TTS-1 HD)",
    openAiKeyHelp: "Cette clé sera utilisée localement pour les fonctionnalités d’analyse et de synthèse vocale.",
    aiVoiceLabel: "Voix IA (TTS)",
    aiVoiceHelp: "Choisissez la voix utilisée pour la lecture des résumés.",
    backupLabel: "Sauvegarde",
    resizeSidebar: "Redimensionner la sidebar",
    renameFolder: "Renommer le dossier",
    removeFolder: "Supprimer le dossier",
    expandFolder: "Déplier",
    collapseFolder: "Replier",
  },
  en: {
    addUrlPlaceholder: "Add an RSS URL…",
    add: "Add",
    emptySidebar: "Add your RSS feeds to get started.",
    settings: "Settings",
    appearanceAndLanguage: "Appearance and language",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    language: "Language",
    french: "French",
    english: "English",
    close: "Close",
    expandSidebar: "Expand sidebar",
    collapseSidebar: "Collapse sidebar",
    rename: "Rename feed",
    remove: "Delete feed",
    discoverError: "Could not find a feed for this URL (20s). Please check the address.",
    showAll: "All",
    todayOnly: "Today",
    refresh: "Refresh",
    sidebarFolders: "Folders",
    sidebarFeeds: "Feeds",
    exportData: "Export",
    importData: "Import",
    importInvalid: "Invalid import file",
    importSuccess: "Import complete",
    exportReady: "Export ready",
    noArticles: "No articles for now.",
    noArticlesToday: "No articles for today.",
    overview: "Overview",
    todayResume: "Today resume",
    generateTodayResume: "Generate today resume",
    generatingResume: "Generating resume…",
    updateResume: "Update",
    viewArticle: "View article",
    play: "Play",
    generating: "Generating…",
    stop: "Stop",
    playDailyDigest: "Play today's digest",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    playbackStarted: "Playing the summary",
    dailySummaryFailed: "Daily digest failed",
    clipboardError: "Couldn't copy the link",
    loadError: "Loading error",
    noFeedDetected: "No RSS feed detected for this URL. Check the address or try another page.",
    openAiMissing: "Missing OpenAI key. Add it in Settings → OpenAI API Key.",
    articleExtractFailed: "Failed to extract the article",
    serverGenError: "Server error during generation",
    addFeed: "Add feed",
    addFolder: "Add folder",
    settingsTooltip: "Settings",
    playAudioSummary: "Play audio summary",
    reorder: "Reorder",
    newFolder: "New folder",
    verifying: "Checking…",
    relaunchOnboarding: "Relaunch onboarding",
    openAiKeyLabel: "OpenAI API Key (GPT-5 / TTS-1 HD)",
    openAiKeyHelp: "This key will be used locally for analysis and text-to-speech features.",
    aiVoiceLabel: "AI Voice (TTS)",
    aiVoiceHelp: "Choose the voice used to read summaries.",
    backupLabel: "Backup",
    resizeSidebar: "Resize sidebar",
    renameFolder: "Rename folder",
    removeFolder: "Delete folder",
    expandFolder: "Expand",
    collapseFolder: "Collapse",
  },
};

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";
  const v = localStorage.getItem(STORAGE_KEY) as Lang | null;
  return v === "fr" ? "fr" : "en";
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    window.dispatchEvent(new CustomEvent(EVT, { detail: lang }));
  } catch {}
}

export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>(getLang());
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as Lang;
      setLangState(d);
    };
    window.addEventListener(EVT, on as EventListener);
    return () => window.removeEventListener(EVT, on as EventListener);
  }, []);
  // Ensure the HTML document language reflects the current app language, including on first mount
  useEffect(() => {
    try {
      document.documentElement.lang = lang;
    } catch {}
  }, [lang]);
  const setter = (l: Lang) => setLang(l);
  return [lang, setter];
}

export function t(lang: Lang, key: string): string {
  const dict = DICT[lang] || DICT.en;
  return dict[key] || key;
}


