type UnsplashPhoto = {
  id: string;
  urls: {
    regular: string;
    small: string;
    thumb: string;
    full: string;
  };
  width?: number;
  height?: number;
  alt_description?: string | null;
};

// Cache pour éviter de réutiliser les mêmes images dans une session
const usedImagesCache = new Set<string>();

export async function getUnsplashImage(query: string, apiKey?: string): Promise<string | null> {
  try {
    const res = await fetch("/api/unsplash/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: query,
        key: apiKey,
        perPage: 5, // Récupérer plusieurs images pour avoir plus de choix
        page: Math.floor(Math.random() * 3) + 1 // Page aléatoire entre 1 et 3
      })
    });

    if (!res.ok) return null;
    
    const data = await res.json();
    const results = (data.results || []) as UnsplashPhoto[];
    
    // Filtrer les images déjà utilisées
    const availableImages = results
      .map(r => r.urls.regular)
      .filter(Boolean)
      .filter(url => !usedImagesCache.has(url));

    if (availableImages.length === 0) {
      // Si toutes les images sont déjà utilisées, réessayer avec les images existantes
      const fallbackImage = results[0]?.urls.regular || null;
      if (fallbackImage) usedImagesCache.add(fallbackImage);
      return fallbackImage;
    }

    // Choisir une image aléatoire parmi celles disponibles
    const randomIndex = Math.floor(Math.random() * availableImages.length);
    const selectedImage = availableImages[randomIndex];
    
    // Ajouter l'image au cache
    if (selectedImage) usedImagesCache.add(selectedImage);
    
    return selectedImage;
  } catch {
    return null;
  }
}
