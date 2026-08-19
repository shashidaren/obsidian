import { QuartzConfig } from "./quartz/cfg"
import * as Plugin from "./quartz/plugins"

/**
 * Custom Quartz config for Senior Linux Admin knowledge base
 * Theme: clean, readable, technical — good on phone and desktop
 */
const config: QuartzConfig = {
  configuration: {
    pageTitle: "Linux Sysadmin Notes",
    pageTitleSuffix: "",
    enableSPA: true,
    enablePopovers: true,
    analytics: {
      provider: "null",
    },
    locale: "en-US",
    baseUrl: "shashidaren.github.io/obsidian",
    ignorePatterns: ["private", "templates", ".obsidian", "99 - Templates", "quartz-config"],
    defaultDateType: "modified",
    theme: {
      fontOrigin: "googleFonts",
      cdnCaching: true,
      typography: {
        header: "Inter",
        body: "Inter",
        code: "JetBrains Mono",
      },
      colors: {
        lightMode: {
          light: "#f8f9fb",
          lightgray: "#e4e6eb",
          gray: "#b0b3b8",
          darkgray: "#3c4048",
          dark: "#1a1d23",
          secondary: "#2563eb",
          tertiary: "#0d9488",
          highlight: "rgba(37, 99, 235, 0.12)",
          textHighlight: "#fef08a88",
        },
        darkMode: {
          light: "#0f1115",
          lightgray: "#2a2e36",
          gray: "#5c6370",
          darkgray: "#c8cdd5",
          dark: "#e8eaed",
          secondary: "#60a5fa",
          tertiary: "#2dd4bf",
          highlight: "rgba(96, 165, 250, 0.15)",
          textHighlight: "#854d0e88",
        },
      },
    },
  },
  plugins: {
    transformers: [
      Plugin.FrontMatter(),
      Plugin.CreatedModifiedDate({
        priority: ["frontmatter", "git", "filesystem"],
      }),
      Plugin.SyntaxHighlighting({
        theme: {
          light: "github-light",
          dark: "github-dark",
        },
        keepBackground: false,
      }),
      Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
      Plugin.GitHubFlavoredMarkdown(),
      Plugin.TableOfContents(),
      Plugin.CrawlLinks({ markdownLinkResolution: "shortest" }),
      Plugin.Description(),
      Plugin.Latex({ renderEngine: "katex" }),
    ],
    filters: [Plugin.RemoveDrafts()],
    emitters: [
      Plugin.AliasRedirects(),
      Plugin.ComponentResources(),
      Plugin.ContentPage(),
      Plugin.FolderPage(),
      Plugin.TagPage(),
      Plugin.ContentIndex({
        enableSiteMap: true,
        enableRSS: true,
      }),
      Plugin.Assets(),
      Plugin.Static(),
      Plugin.Favicon(),
      Plugin.NotFoundPage(),
    ],
  },
}

export default config
