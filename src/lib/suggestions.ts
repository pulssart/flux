export type SuggestedFeed = {
  title: string;
  url: string;
  domain?: string;
};

// Suggestions inspirées de la collection "awesome-rss-feeds"
// https://github.com/plenaryapp/awesome-rss-feeds
export const SUGGESTED_FEEDS: SuggestedFeed[] = [
  { title: "01net", url: "https://www.01net.com/feed/", domain: "01net.com" },
  { title: "9to5Mac", url: "https://9to5mac.com/feed/", domain: "9to5mac.com" },
  { title: "Al Jazeera – All News", url: "https://www.aljazeera.com/xml/rss/all.xml", domain: "aljazeera.com" },
  { title: "Android Police", url: "https://www.androidpolice.com/feed/", domain: "androidpolice.com" },
  { title: "Apple Newsroom", url: "https://www.apple.com/newsroom/rss-feed.rss", domain: "apple.com" },
  { title: "Ars Technica", url: "http://feeds.arstechnica.com/arstechnica/index", domain: "arstechnica.com" },
  { title: "BBC News – Home", url: "http://feeds.bbci.co.uk/news/rss.xml", domain: "bbc.co.uk" },
  { title: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", domain: "bleepingcomputer.com" },
  { title: "CNET – News", url: "https://www.cnet.com/rss/news/", domain: "cnet.com" },
  { title: "CNN – Top Stories", url: "http://rss.cnn.com/rss/edition.rss", domain: "cnn.com" },
  { title: "Engadget", url: "https://www.engadget.com/rss.xml", domain: "engadget.com" },
  { title: "Financial Times – Home", url: "https://www.ft.com/?format=rss", domain: "ft.com" },
  { title: "GitHub Blog", url: "https://github.blog/feed/", domain: "github.blog" },
  { title: "Gizmodo", url: "https://gizmodo.com/feed", domain: "gizmodo.com" },
  { title: "Google – The Keyword", url: "https://www.blog.google/rss/", domain: "blog.google" },
  { title: "Hacker News – Front Page", url: "https://hnrss.org/frontpage", domain: "news.ycombinator.com" },
  { title: "HackerNoon", url: "https://hackernoon.com/feed", domain: "hackernoon.com" },
  { title: "Le Monde – Une", url: "https://www.lemonde.fr/rss/une.xml", domain: "lemonde.fr" },
  { title: "Les Echos – Une", url: "https://www.lesechos.fr/rss/rss_une.xml", domain: "lesechos.fr" },
  { title: "Lifehacker", url: "https://lifehacker.com/rss", domain: "lifehacker.com" },
  { title: "MacRumors", url: "https://www.macrumors.com/macrumors.xml", domain: "macrumors.com" },
  { title: "Microsoft Official Blog", url: "https://blogs.microsoft.com/feed/", domain: "microsoft.com" },
  { title: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", domain: "technologyreview.com" },
  { title: "NASA – Breaking News", url: "https://www.nasa.gov/rss/dyn/breaking_news.rss", domain: "nasa.gov" },
  { title: "Next INpact", url: "https://www.nextinpact.com/rss/news.xml", domain: "nextinpact.com" },
  { title: "NPR – Top Stories", url: "https://feeds.npr.org/1001/rss.xml", domain: "npr.org" },
  { title: "NYTimes – Home Page", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", domain: "nytimes.com" },
  { title: "NVIDIA Blog", url: "https://blogs.nvidia.com/feed/", domain: "nvidia.com" },
  { title: "OpenAI Blog", url: "https://openai.com/blog/rss.xml", domain: "openai.com" },
  { title: "Product Hunt", url: "https://www.producthunt.com/feed", domain: "producthunt.com" },
  { title: "Reddit – r/worldnews", url: "https://www.reddit.com/r/worldnews/.rss", domain: "reddit.com" },
  { title: "Reuters – Top News", url: "http://feeds.reuters.com/reuters/topNews", domain: "reuters.com" },
  { title: "Slashdot", url: "http://rss.slashdot.org/Slashdot/slashdotMain", domain: "slashdot.org" },
  { title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/", domain: "smashingmagazine.com" },
  { title: "Stack Overflow Blog", url: "https://stackoverflow.blog/feed/", domain: "stackoverflow.blog" },
  { title: "TechCrunch", url: "http://feeds.feedburner.com/TechCrunch", domain: "techcrunch.com" },
  { title: "Techmeme", url: "https://www.techmeme.com/feed.xml", domain: "techmeme.com" },
  { title: "The Atlantic – All", url: "https://www.theatlantic.com/feed/all/", domain: "theatlantic.com" },
  { title: "The Economist – Latest", url: "https://www.economist.com/latest/rss.xml", domain: "economist.com" },
  { title: "The Guardian – Technology", url: "https://www.theguardian.com/uk/technology/rss", domain: "theguardian.com" },
  { title: "The Guardian – World", url: "https://www.theguardian.com/world/rss", domain: "theguardian.com" },
  { title: "The New Yorker – News", url: "https://www.newyorker.com/feed/news", domain: "newyorker.com" },
  { title: "The Next Web", url: "https://thenextweb.com/feed/", domain: "thenextweb.com" },
  { title: "The Register – Headlines", url: "https://www.theregister.com/headlines.atom", domain: "theregister.com" },
  { title: "The Verge – All Posts", url: "https://www.theverge.com/rss/index.xml", domain: "theverge.com" },
  { title: "The Washington Post – World", url: "https://feeds.washingtonpost.com/rss/world", domain: "washingtonpost.com" },
  { title: "Vox – All", url: "https://www.vox.com/rss/index.xml", domain: "vox.com" },
  { title: "Wired", url: "https://www.wired.com/feed/rss", domain: "wired.com" },
  { title: "XKCD", url: "https://xkcd.com/rss.xml", domain: "xkcd.com" },
  { title: "ZDNet – News", url: "https://www.zdnet.com/news/rss.xml", domain: "zdnet.com" },
].sort((a, b) => a.title.localeCompare(b.title));


