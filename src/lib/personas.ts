export type Persona = "designer" | "geek" | "ceo";

export const PERSONAS: Record<Persona, {
  title: { fr: string; en: string };
  description: { fr: string; en: string };
  feeds: Array<{ title: string; url: string }>;
}> = {
  designer: {
    title: {
      fr: "Designer",
      en: "Designer"
    },
    description: {
      fr: "Restez à jour sur les dernières tendances du design, de l'UX et de la créativité",
      en: "Stay up to date with the latest design trends, UX and creativity"
    },
    feeds: [
      { title: "Smashing Magazine", url: "https://www.smashingmagazine.com/feed/" },
      { title: "UX Movement", url: "https://uxmovement.com/feed/" },
      { title: "Dribbble Blog", url: "https://dribbble.com/blog.rss" },
      { title: "Behance Blog", url: "https://medium.com/feed/behance-blog" },
      { title: "Design Milk", url: "https://design-milk.com/feed/" },
      { title: "Sidebar.io", url: "https://sidebar.io/feed.xml" },
      { title: "UX Design Weekly", url: "https://uxdesignweekly.com/feed/" },
      { title: "A List Apart", url: "https://alistapart.com/feed/" },
      { title: "UI/UX Design", url: "https://medium.com/feed/ui-ux-design-trends" },
      { title: "InVision Blog", url: "https://www.invisionapp.com/blog/feed/" }
    ]
  },
  geek: {
    title: {
      fr: "Geek",
      en: "Geek"
    },
    description: {
      fr: "Ne manquez rien de l'actualité tech, du dev et des nouvelles technologies",
      en: "Stay on top of tech news, development and new technologies"
    },
    feeds: [
      { title: "Hacker News", url: "https://news.ycombinator.com/rss" },
      { title: "TechCrunch", url: "https://techcrunch.com/feed/" },
      { title: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
      { title: "GitHub Blog", url: "https://github.blog/feed/" },
      { title: "Dev.to", url: "https://dev.to/feed/" },
      { title: "CSS-Tricks", url: "https://css-tricks.com/feed/" },
      { title: "Wired", url: "https://www.wired.com/feed/rss" },
      { title: "ArsTechnica", url: "https://arstechnica.com/feed/" },
      { title: "ReadWrite", url: "https://readwrite.com/feed/" },
      { title: "VentureBeat", url: "https://venturebeat.com/feed/" }
    ]
  },
  ceo: {
    title: {
      fr: "CEO Tech",
      en: "Tech CEO"
    },
    description: {
      fr: "Suivez les tendances business, l'innovation et la stratégie tech",
      en: "Follow business trends, innovation and tech strategy"
    },
    feeds: [
      { title: "Harvard Business Review", url: "https://hbr.org/feed" },
      { title: "MIT Technology Review", url: "https://www.technologyreview.com/feed/" },
      { title: "Forbes Tech", url: "https://www.forbes.com/technology/feed/" },
      { title: "McKinsey Digital", url: "https://www.mckinsey.com/mgi/rss" },
      { title: "Fast Company", url: "https://www.fastcompany.com/feed" },
      { title: "Inc.com Tech", url: "https://www.inc.com/rss/tech.xml" },
      { title: "Business Insider Tech", url: "https://www.businessinsider.com/sai/rss" },
      { title: "ZDNet", url: "https://www.zdnet.com/news/rss.xml" },
      { title: "Sloan Management Review", url: "https://sloanreview.mit.edu/feed/" },
      { title: "CIO.com", url: "https://www.cio.com/feed" }
    ]
  }
};
