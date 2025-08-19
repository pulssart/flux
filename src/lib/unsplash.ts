export async function getUnsplashImage(query: string, apiKey?: string): Promise<string | null> {
  try {
    const res = await fetch("/api/unsplash/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: query,
        key: apiKey,
        perPage: 1,
        page: 1
      })
    });

    if (!res.ok) return null;
    
    const data = await res.json();
    const image = data.results?.[0]?.regular || null;
    return image;
  } catch {
    return null;
  }
}
